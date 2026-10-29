+++
title = "Rendering GitOps: how we built an ArgoCD repository with KCL"
date = 2026-10-29

[taxonomies]
tags = ["kubernetes", "platform-engineering", "devops", "gitops"]

+++

{{ banner(src="/img/kcl-gitops/banner.webp",
          alt="A prism transforming stacked shapes into orderly sets of cubes.",
          size="width:100%;height:300px;",
          style="margin:-9% 0") }}

Our GitOps repository needed Go templates, Kustomize overlays, CUE schemas, and Python scripts just
to make configuration changes reasonably safe. Even then, removing a redundant override could
briefly trigger a downgrade. We decided to rethink how we assembled our Argo CD applications, using
KCL to generate and validate their definitions before they reached the cluster. In this post, I walk
through the component model we built, how it changed our review workflow, and where the additional
machinery earns its keep.

<!-- more -->

# The pain we started from

Our GitOps repository had a component directory per deployment unit, a Kustomize overlay per
platform, and one `ApplicationSet` per component. Each platform patched the Git file generator so
that Go templates could read its configuration:

```yaml
destination:
  namespace: "team-widget-{{ .platform.env }}"
syncOptions:
  - ApplyOutOfSyncOnly={{ dig "components" "widget" "syncOptions" "ApplyOutOfSyncOnly" "true" . }}
```

This worked, but understanding a change meant mentally evaluating templates, platform values, and
defaults. The files we reviewed were the inputs to an `Application`, rather than the `Application`
itself.

Initially, we only saw the generated result after a change landed on `main` and the controllers
reconciled it. We added CUE schemas and Python scripts to check that configuration was valid and
that the `dig` lookups resolved. Eventually, we also built a pipeline that asked Argo CD to render
changes before merging and posted the diff on the pull request.

That improved visibility, but the feedback loop could take tens of minutes. We had assembled several
technologies and a cluster-dependent workflow to make one abstraction trustworthy.

There was another problem that validation alone did not solve.

## When a cleanup becomes a downgrade

Suppose a component defaults to version 1, but a platform overrides it to version 2. Once every
platform uses version 2, we update the component default and remove the overrides. This should leave
the resulting applications unchanged.

In our setup, however, the `ApplicationSet` template and the platform configuration used by its Git
generator were updated through separate reconciliation paths. We observed a sequence where the
generator picked up the removal of an override before the controller received the updated template.
The controller temporarily combined the new platform configuration with the old default, generating
an `Application` pointing back to version 1.

With automated sync, that could trigger a downgrade, followed by another upgrade once the remaining
configuration caught up.

This was a consequence of how we assembled and reconciled those inputs. The
[Git generator documentation](https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/Generators-Git/)
describes polling and revision-cache behavior, but the important point for our design was simpler:
we wanted to resolve component defaults and platform overrides together, before either reached the
cluster.

# The design

We replaced the ApplicationSet templates with a small KCL module. Its model has two parts:

- **Components** describe a deployment unit: one or more related Helm charts, their defaults, and
  the settings shared across platforms.
- **Platforms** select the components to deploy to a Kubernetes cluster and specify the differences
  from those defaults.

A render step turns each platform definition into concrete Argo CD `Application` resources. CI
writes those resources to `manifests/<platform>/`, which is the configuration Argo CD consumes.

There are still two rendering stages. KCL generates the `Application` definitions before deployment.
Argo CD then renders the Helm charts referenced by those applications and reconciles their
resources. We moved the composition of applications out of the cluster; we kept Helm rendering in
Argo CD.

This applies the [rendered manifests pattern](https://akuity.io/blog/the-rendered-manifests-pattern)
to the application-definition layer. We do not store the final Helm-generated workload manifests in
Git.

## Components: the typed vocabulary

A component is a value in a KCL package. It holds the defaults that should be shared across
platforms: chart revisions, Helm release-name settings, values, namespace prefixes, sync policy, and
labels.

```kcl
# components/web/widget.k
import file
import yaml

import ..lib as lib

widget = lib.Component {
    name = "web/widget"
    namespacePrefix = "team-widget-"
    charts = [
        lib.Chart {
            name = "acme/widget"
            version = "acme/widget/v1.4.2"
            releaseName = "widget"
            values = yaml.decode(file.read("widget.values.yaml"))
        }
        lib.Chart {
            name = "acme/widget-sidecar"
            version = "acme/widget-sidecar/v0.3.0"
            releaseName = "widget-sidecar"
        }
    ]
}
```

The version strings follow our repository's chart-tag convention. They identify the revision of the
chart source, separately from any container image tag supplied through Helm values.

A component can contain more than one chart when those charts belong to the same deployment unit.
Each chart becomes one source in the resulting `Application`. They therefore share an Argo CD
application lifecycle. This is useful for closely related charts, but would be an awkward way to
group otherwise independent applications.

Although we configure a `releaseName` for each Helm source, Argo CD manages the deployed resources
itself. It uses
[Helm to generate manifests](https://argo-cd.readthedocs.io/en/latest/user-guide/helm/), rather than
managing ordinary Helm releases.

There is no separate component registry to maintain. A component is a top-level variable, and a
platform refers to it by symbol, such as `web.widget`.

## Platforms: explicit differences

A platform directory contains a `platform.k` file with its name, environment, selected components,
and chart overrides. Values that differ from the component defaults live in YAML files next to it:

```kcl
# platforms/p-north-01/platform.k
import ...components as gitops
import ...components.core as core
import ...components.web as web

import file
import yaml

name = "p-north-01"
env = "d"

applications = gitops.manifests(name, env, [
    {
        component = web.widget
        charts = [
            {
                name = "acme/widget"
                values = yaml.decode(file.read("widget.values.override.yaml"))
            }
        ]
    }
    {
        component = core.queue
        charts = [
            {
                name = "acme/queue"
                version = "acme/queue/v2.0.0"
            }
        ]
    }
])
```

```yaml
# platforms/p-north-01/widget.values.override.yaml
image:
  tag: v1.4.2-rc1
```

Here, the widget override selects its chart by name and changes a container image tag through its
values. The queue override changes the chart revision itself. These are independent choices.

The split is deliberate: components define shared defaults, while platforms state their exceptions.
Rolling out a new default means editing the component. Keeping one platform on a different revision
means setting the override there.

## The render step

`manifests()` takes the platform name, environment, and application definitions. It combines the
component defaults with platform overrides and constructs the Argo CD objects.

We use generated Argo CD models from the
[KCL community modules](https://github.com/kcl-lang/modules/tree/main/argo-cd), rather than
maintaining the `Application` schema ourselves. Our own schemas describe the higher-level component
and platform inputs; the imported schemas describe the output resources.

We generate the set of `Application` resources:

```kcl
# components/manifests.k
import argo_cd.v1alpha1.argoproj_io_v1alpha1_application as argo
# some code is omitted...

# one ArgoCD source per chart of the component, with the platform's overrides
source = lambda chart: Chart, overrides: [ChartOverride] -> any {
    override = overrides[0] if overrides else {}

    # the union re-evaluates the derived attributes, so `version_is_tag` is about
    # the effective version
    effective = chart | {
        **({"version" = override.version} if override.version else {})
        **({"releaseName" = override.releaseName} if override.releaseName else {})
    }

    values = {**chart.values, **override.values}

    {
        repoURL: effective.repoURL
        path: effective.path
        targetRevision: effective.version
        helm = {
            releaseName = effective.releaseName
            **({"valuesObject" = values} if values else {})
        }
    }
}

# NB: no local may be called `name`, dict literal keys shadow it
application = lambda app: Application, platform: str, env: str -> argo.Application {
    component = app.component
    application_name = app.name or component.name.replace("/", "-")

    chart_names = [c.name for c in component.charts]
    unnamed = [o for o in app.charts if not o.name]
    assert len(unnamed) == 0 or len(component.charts) == 1, "component '${component.name}' has ${len(component.charts)} charts, so an override has to set 'name'"
    unknown = [o.name for o in app.charts if o.name and o.name not in chart_names]
    assert len(unknown) == 0, "component '${component.name}' has no chart ${unknown}, it has ${chart_names}"

    argo.Application {
        metadata = {
           # some more code...
        }
        spec = {
            project = component.project
            destination = {
                server = "https://kubernetes.default.svc"
                namespace = (app.namespacePrefix or component.namespacePrefix) + env
            }
            syncPolicy = {
                automated = {
                    selfHeal = component.syncPolicy.selfHeal
                    prune = component.syncPolicy.prune
                } if component.syncPolicy.automated else Undefined
                syncOptions = component.syncPolicy.syncOptions
            }
            revisionHistoryLimit = component.revisionHistoryLimit
            sources = [source(c, overrides_of(app, c)) for c in component.charts]
        }
    }
}
```

and them dump them to files:

```kcl
MANIFESTS_DIR = option("manifests_dir") or "manifests"

# Write one YAML file per application to `manifests/<platform>/<application>.yaml`,
# so that a plain `kcl run` of a platform dumps its manifests.
dump = lambda platform: str, applications: [any] -> bool {
    dir = file.modpath() + "/" + MANIFESTS_DIR + "/" + platform
    _created = file.mkdir(dir)
    _written = [yaml.dump_to_file(a, dir + "/" + a.metadata.name + ".yaml") for a in applications]
    True
}

manifests = lambda {
    platform: str,
    env: str,
    applications: [lib.Application],
} -> [argo.Application] {
    assert regex.match(platform, r"^[a-z]-[a-z0-9-]+$"), "platform name '${platform}' must look like '<letter>-<something>', e.g. p- or c-"
    assert regex.match(env, r"^[a-z]$"), "env '${env}' must be a short lowercase environment letter"

    rendered = [lib.application(app, platform, env) for app in applications]
    names = [a.metadata.name for a in rendered]
    duplicates = [n for n in names if len([m for m in names if m == n]) > 1]
    assert len(duplicates) == 0, "duplicate application name(s) ${duplicates}"

    _dumped = output.dump(platform, rendered)
    rendered
}
```

The renderer writes one file per application to `manifests/<platform>/<application>.yaml`. Each file
contains the resolved application definition, including its destination, source revisions, and
values. Argo CD no longer needs to reconstruct that definition from an ApplicationSet template and
separately refreshed platform configuration.

For the earlier default-and-override cleanup, this gives us a useful property: both inputs are
evaluated together from the same source checkout. If the resolved application has not changed, its
generated YAML does not change either. This removes the mixed-input failure we encountered; it does
not make deployment across multiple applications atomic.

# What changed for us

## The model catches mistakes before deployment

The type system makes the configuration easier to navigate. Component references are symbols,
schemas document the available fields, and mistakes can produce diagnostics close to the input that
caused them:

```text
error[E2L23]: CompileError
Cannot add member 'componnt' to schema 'Application', did you mean '["component"]'?
```

Our own checks also catch mistakes that are structurally valid but meaningless in the model. An
override targeting a nonexistent chart produces an error such as:

```text
component 'infra/docs' has no chart [acme/doc], it has [acme/docs, acme/permission-sync]
```

That is much more useful than finding out later that a configuration change did nothing.

KCL's `check` blocks and assertions let us keep configuration rules next to the schemas they
constrain. For example, we check that namespace prefixes end with `-`, because we append the
environment letter, and that application names are unique within a platform. We also require
distinct release-name settings within a component as a naming safeguard, although that alone cannot
prove the charts generate distinct Kubernetes resources.

Not every rule is an error. We warn when a chart revision does not follow our tag convention,
because we occasionally deploy a branch deliberately. That warning checks our convention; it does
not establish that the referenced revision exists.

These checks cover the model we have defined. They do not automatically validate every key in a YAML
values file against the corresponding chart. The generated `Application` schema knows about
`helm.valuesObject`, but chart-specific values need their own validation. Helm rendering and
deployment can still fail for reasons outside our KCL model.

## Reviewing the result becomes a local operation

Our diff command re-renders every platform into a scratch directory and compares the generated
application definitions with the committed output. A reviewer can see which applications change,
which source revisions move, and which values or sync settings differ.

On our repository, local generation takes a few hundred milliseconds on a laptop. That timing covers
KCL generation of the application resources. It excludes chart downloads, Helm rendering, and
comparison with live cluster state.

Previously, getting feedback meant pushing a change and waiting for the pipeline to ask Argo CD to
render it. That complete loop could take tens of minutes. Now we can inspect the
application-definition delta locally before pushing anything, and CI posts that delta on the pull
request.

The distinction matters: a changed Helm value appears in this diff, but the resulting change to a
`Deployment` does not. We can review the exact application configuration we intend to publish
without claiming that we have already inspected every workload it will produce.

## The pipeline owns the generated files

Contributors edit components, platform definitions, and values files. They do not edit `manifests/`
directly; a check rejects those changes. The pull request contains the source changes, and the
generated delta is available in its review comments.

After merge, a second pipeline renders the repository and commits the generated applications. Argo
CD then picks them up. Generating and committing the output is part of the delivery process, rather
than a step someone has to remember locally.

This also gives us two things to inspect when something goes wrong: the source configuration that
expressed the change and the generated `Application` that was published.

# What we still own

Moving generation into CI adds responsibility there. We maintain the component model, rendering and
diff scripts, and the check protecting the generated directory. The supporting shell scripts and KCL
amount to a few hundred lines, but line count is only part of the maintenance cost.

The publication step is now part of the deployment path. If it fails after merge, the generated
configuration remains behind the source configuration. Concurrent runs also need care: an older
render must not overwrite output from a newer change. Reproducibility requires keeping the KCL
toolchain and model dependencies under control, including the generated types for the Argo CD
version we run.

KCL is also less familiar to most engineers than YAML or Helm. Its syntax will feel familiar to
people who know Python, but learning the language and understanding our model still takes time. We
have replaced a collection of abstractions with one we find easier to reason about; we still have an
abstraction to maintain.

Finally, there are useful failure modes this design does not eliminate. A valid `Application` can
reference an unavailable chart revision. Helm can reject values or generate resources that the
target cluster will not accept. Cluster policy still has a role, especially for changes that do not
pass through this repository.

# Why KCL?

Generating applications before deployment does not require KCL. We could have invested further in
evaluating the existing templates locally, or built a similar model using another configuration
language.

What we appreciate about KCL is that the abstractions, types, constraints, and output construction
live together. We no longer need Go templates for the application definitions, CUE for their input
schemas, and Python to check the relationship between them.

The two decisions solve related problems: generating before deployment makes application definitions
inspectable, while KCL gives us a way to express and validate how those definitions are assembled.

For a small repository with straightforward applications, maintaining this model might cost more
than it saves. For us, the repeated platform configuration, shared defaults, and existing validation
machinery made the trade-off worthwhile.

# Day to day

A change now looks like this: edit a component or platform, run the formatter and checks, inspect
the generated application delta, and open a pull request. CI posts the same kind of delta for the
reviewer. Once the change is merged, the publication pipeline updates the generated applications and
Argo CD reconciles them.

Argo CD still does important work, including rendering Helm charts. It no longer has to assemble our
application definitions from several layers of templates and platform configuration. That is a
smaller responsibility, and one we find much easier to debug.

# Closing thoughts

The most useful change was making the resolved application definition something we could inspect
before deployment. KCL gave us a typed model for producing it, with constraints that describe how
our repository is supposed to work.

If your GitOps repository has accumulated ApplicationSet templates, `dig` lookups, overlay patches,
and separate validation scripts, this approach is worth exploring. Start with one deployment unit,
generate its `Application` alongside the existing setup, and compare the result. That will tell you
more about whether the model fits your repository than migrating everything at once.

And if you want the longer argument for why a compiled, constraint-based language fits platform
engineering, I wrote about that
[here](https://f4z3r.github.io/why-kcl-matters-for-platform-engineers/).
