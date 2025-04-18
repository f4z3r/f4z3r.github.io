+++
title = "A Comprehensive Guide to Managing Large Scale Infrastructure with GitOps"
date = 2025-03-30

[taxonomies]
tags = ["platform-engineering", "sre", "gitops"]

+++

{{ banner(src="/img/gitops-intro/old-wooden-trading-ship.jpeg",
          alt="An old wooden trading ship navigating the wide ocean",
          size="width:100%;height:300px;",
          style="margin:-30% 0") }}

GitOps is getting adopted more and more. However, there still seems to be some confusion as to what
GitOps is, how it differs from regular CI/CD pipelines, and how to best adopt it. In this post we
will quickly cover what GitOps is, and the three main lessons learned from using GitOps to manage
infrastructure at scale both on premise and in the cloud.

<!-- more -->

# GitOps Overview

GitOps is a set of principles enabling the operation of a system via version controlled, declarative
configuration. More specifically, the [OpenGitOps](https://opengitops.dev/) project defines four
principles which define whether a system or set of systems is managed via GitOps:

- Declarative: A system managed by GitOps must have its desired state expressed declaratively.
- Versioned and Immutable: Desired state is stored in a way that enforces immutability, versioning
  and retains a complete version history.
- Pulled Automatically: Software agents automatically pull the desired state declarations from the
  source.
- Continuously Reconciled: Software agents continuously observe actual system state and attempt to
  apply the desired state.

Note that `git` is not referenced anywhere, as GitOps is not bound to any tooling. However, in
layman terms, many consider a system operated via `git` to be a GitOps system. This is not quite
correct.

# GitOps is More than CI/CD Pipelines

Taking the "layman's definition" from above, any system that has CI/CD via pipelines triggered on
repository changes would be a GitOps system. This is not accurate. Consider an IaC pipeline which
applies declaratively defined infrastructure (such as a standard `opentofu apply` in a pipeline, or
a Docker build followed by a `kubectl apply`). While such a system adheres to the first two
principles, it does not adhere to the latter two. This implies that changes made to the target
system are not corrected (reconciled) until the pipeline runs the next time. Similarly, if the
pipeline fails for whatever reason, the desired state does not change the pipeline: a configuration
drift is not detected, even if not reconciled.

This is an important distinction when considering "standard CI/CD" and GitOps. Simply having
something declared as code does not make it GitOps.

# The Advantages of GitOps

GitOps has many advantages over standard ways of managing systems. The advantages of having a
declarative desired state, version controlling it, and interacting with the system only via `git`
(or whatever version control system you use) are tremendous. From improved security and higher
efficiency to better change visibility. These are well known to most people and will thus not be
covered here.

Drift detection and automatic reconciliation are the two other aspects that make GitOps absolutely
amazing. This is especially true in the current day and age, with the proliferation of complex
systems being worked on by many people concurrently. Being able to observe that the system is not in
the desired state has massive advantages, such as for standard SRE operations. Continuous
reconciliation ensures that manual operational tasks are kept to a minimum, and that systems cannot
degrade over time as small undesired changes creep in.

# Tooling

In this post we will mostly focus on using GitOps to manage resources handled via the Kubernetes
API, but it should be noted that GitOps as a concept is in no way restricted to Kubernetes. In the
Kubernetes space there are two major players for GitOps: [ArgoCD](https://argoproj.github.io/cd/)
and [FluxCD](https://fluxcd.io/). We will not go into the details as to what the advantages for each
tool are, other than saying that according to our own experience, ArgoCD might be more developer
focused, while FluxCD might suit platform engineers with more Kubernetes experience that want more
flexibility.

The rest of this post is tool agnostic and everything we are talking about can be done with either
tool (but some aspects might be easier to do with one or the other).

# Infrastructure: Disambiguation

Before we dive into how to structure your GitOps configuration, it might make sense to draw a line
as to where infrastructure starts and where it ends. We consider infrastructure everything that is
part of the platform provided to an application team. Hence this line might vary depending on the
maturity of the platform you provide your teams. If we consider a simple Kubernetes platform with
little additional abstraction for its users, the infrastructure would contain the Kubernetes
platform itself as well as all system components that are shared between the teams, such as a
central monitoring stack, a central credential management solution, centralized policy enforcement
of specific Kubernetes resources, and the like.

The lower end of the spectrum will likely not be managed by GitOps. That is simply because the
GitOps tooling itself typically needs to run somewhere, and also needs to be bootstrapped somehow.
Some tools such as FluxCD allow the GitOps controller to manage itself, but even in these cases the
runtime for the controller needs to exist when the controller is initially installed, and is thus
typically not part of the GitOps configuration.

Now that this is cleared up, let us consider how the configuration should be managed.

# App-of-Apps

A very popular pattern for managing configuration via GitOps is the "app-of-apps" pattern. This was
popularized by ArgoCD, but is also applicable to other tooling. We will use ArgoCD in the example
below, but the same can be implemented using FluxCD Kustomizations.

Let us consider a component from our infrastructure that we want to manage via GitOps. Typically, we
would need to tell the GitOps controller how to manage this component. For instance, let us assume
the component is installed via raw Kubernetes manifests. Then we would tell the GitOps controller
which repository contains these manifests and in which namespace to install them. Depending on the
controller you are using, you might also configure additional parameters such as how often it should
be reconciled, whether it depends on other components, and so on. In ArgoCD jargon this would be an
"Application" (the root of "app-of-apps" naming), and would look as follows:

```yaml,linenos
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: sealed-secrets
  namespace: argocd
spec:
  project: default
  source:
    chart: sealed-secrets
    repoURL: https://bitnami-labs.github.io/sealed-secrets
    targetRevision: 1.16.1
    helm:
      releaseName: sealed-secrets
  destination:
    server: "https://kubernetes.default.svc"
    namespace: kubeseal
```

You would then apply this `Application` resource to Kubernetes. Your component would then be managed
by GitOps, as any changes you push to the manifests repository would be reflected on the Kubernetes
cluster.

Then a second infrastructure component needs to be installed, and you repeat the process. The result
would be a second `Application` which installs and manages a component. You might also want to
version your deployment (such as using version `1.16.1` of the Helm chart). This implies that
lifecycles require a change to this `Application` manifest, and thus a call against the Kubernetes
API to edit it.

The end result is a set of `Application` resources, some of which you periodically modify when
lifecycling a component. Now imagine you need to deploy your infrastructure elsewhere (for instance
a second Kubernetes cluster in our example), or maybe even a couple dozen times. Then you need to
manage this entire set of `Application` resources on every platform. A better approach is to add an
abstraction layer, which itself deploys the `Application` resources via GitOps. Hence you put all
your `Application` resources into a repository, and define another, "higher level" `Application`
which deploys this repository. This means that when deploying to new platforms, you only need to
deploy that one "higher level" `Application`, and any changes to the component `Application`
resources can be made via Git, conforming to our GitOps approach. This "higher level" `Application`
is only there to deploy the component `Application`s thus the name "app-of-apps". Visually, you thus
have the following structure:

{{ image(src="/img/gitops-intro/app-of-apps.excalidraw.svg",
         alt="Visual representation of app-of-apps pattern", style="border-radius: 8px;") }}

It should be noted that this also massively helps when customizing platforms. Typically, components
cannot be deployed truly one-to-one in several places, but require slight configuration differences.
Consider for instance hostnames for UIs of your components. Two of these components deployed in
different locations cannot share the same hostname and routing. Using an "app-of-apps" approach
allows you to define variables on the top level application, and inject these into the downstream
applications such that they can slightly adapt the way they are installed. We will not dive deeper
into how this is done as it is highly dependent on the tooling you use (ArgoCD uses
`ApplicationSet`, FluxCD uses variable substitution), but know this is enabled by such an approach.


# Consolidating your Configuration

In the organisation I first used GitOps at scale, we deployed all our components as Helm charts to a
Kubernetes cluster. Each component was essentially contained within two different repositories in
our version control system:

1. the source code repository which typically built a Docker image as an artefact
2. the Helm chart definition which referenced the Docker image from above

When we then introduced GitOps, we decided to add a third repository containing the exact deployment
definition (in our case the `Application` declarations) for the component. Using the app-of-apps
pattern from above, we could then reference each of these "GitOps repositories" and deploy specific
overlays (customizations) of the `Application` to specific platforms. This worked well for quite
some time. However, with time the number of components we managed increased, and so did the number of
target platforms to which these components needed to be deployed. This lead to quite a few issues.

When a new target platform was introduced, all such "GitOps repositories" needed to be updated to
contain a new overlay customizing the `Application` to the specific platform. This is very tedious
when you have several dozen such repositories.

Moreover, components had dependencies to other components. This meant that we were referencing
components within a repository that were defined in another repository. While not problematic in
itself, this can become very tricky when one component has a dependency on a configuration value of
another component. The configuration value is then duplicated in both repositories and becomes
difficult to maintain. While this sounds like we did not properly separate the components, it is
very common to see such cases in infrastructure configurations. Consider for instance a deployment
of an ingress controller which defines a hostname suffix for its routes. All components deployed on
the same Kubernetes platform that deploy a route/ingress will need to use exactly that hostname
suffix in order to have valid routing.

The above issue also results in tricky situations when configurations need to be changed for
components that are dependent on one another. If the deployment configuration is separated into
different repositories, PRs to these repositories need to be synchronized to ensure the deployment
occurs at the same time.

Finally, distributing the deployment configuration over so many repositories meant that it became
increasingly difficult to have an overview of what is deployed on a target platform. One would need
to navigate through dozens of repositories to check this is correctly done.

After identifying these issues we decided to move all our configuration into a single repository.
This repository would then contain a templated definition of the entire set of components which
would need to be deployed. A set of platform definitions within the same repository would then feed
values to templates to ensure consistent configuration. This massively helped us with to address the
issues mentioned above. On top of that, it allows to version the "template" and thus enables
rollouts of a versioned infrastructure layer. You can find an example repository of such a structure
designed with FluxCD here: [FluxCD Monorepo Demo](https://github.com/f4z3r/flux-demo).

{{ image(src="/img/gitops-intro/app-of-apps-monorepo.excalidraw.svg",
         alt="Visual representation of app-of-apps pattern", style="border-radius: 8px;") }}

# Gitops Bridge

The last challenge we want to address in this blog post is a concept called a "GitOps bridge". In
public cloud environments, there is typically a relatively strong cut between infrastructure
deployed via Terraform (or any similar tool), and the infrastructure deployed via GitOps. For
instance, one might deploy an Azure Kubernetes Service and some surrounding services (such as the
required network, a container registry, etc) via Terraform, and them deploy components and
applications within the AKS using GitOps. The issue that we face here is that the GitOps
configuration very often depends on the Terraform configuration. Consider for instance the container
registry. Its address is set up by Terraform, but is used in every image declaration in the GitOps
configuration. One option is to duplicate such values in the respective configurations, while
another option is to use a GitOps bridge.

The GitOps bridge is an abstract concept on how to pass configuration values from tooling such as
Terraform as inputs to the GitOps configuration. How this is done in practice very much depends on
which tools you use. For instance, if looking at Terraform and FluxCD, a common way to achieve this
is to have Terraform write a ConfigMap onto the AKS where the FluxCD controller will run containing
all variables (and their values) that will be required by the GitOps configuration. The FluxCD
controller then supports injecting variables from a ConfigMap via [variable
substitution](https://fluxcd.io/flux/components/kustomize/kustomizations/#post-build-variable-substitution).

Using a GitOps bridge has the advantage that changes in the Terraform configurations are much less
likely to break the GitOps configuration that builds on top of it. Moreover, it allows Terraform to
directly bootstrap the entire GitOps setup when creating new platforms without the need to manually
redefine the required variables in the GitOps repository.

# Summary

So, to recap, we have looked at what GitOps really is (and isn't). Understanding these basics is
critical to correctly implement GitOps in your projects. On top of that, we looked at three best
practices:

1. Use an app-of-apps pattern to improve resiliency for when you need to recreate platforms.
2. Consider using a mono-repository for all your GitOps configuration as your setup grows.
3. Have a look at GitOps bridges to improve the automation when setting up platforms and ensuring
   your Terraform and GitOps configurations are consistent.

I hope this has helped you understand a bit better how to use GitOps at scale. If you have any
questions or comments, feel free to let me know below.


