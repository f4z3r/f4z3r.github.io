+++
title = "Why KCL Matters for Platform Engineers"
date = 2026-05-02

[taxonomies]
tags = ["kubernetes", "platform-engineering", "devops", "gitops"]

+++

{{ banner(src="/img/kcl/banner.webp",
          alt="A robot working on a computer writing code.",
          size="width:100%;height:300px;",
          style="margin:-9% 0") }}

> **Author’s Note**: I have contributed to the [KCL](https://www.kcl-lang.io/) project and have run
> thousands of KCL programs while exploring the language and executing its test suite. These
> insights and benchmarks come from hands‑on experience. While I currently do not use KCL in
> production, I've focused on solving real platform engineering challenges with it.

# The Pain of YAML Sprawl

As teams adopt Kubernetes and GitOps, they wrestle with thousands of YAML files. YAML is
human‑readable but offers no abstraction, so companies build their own templating and validation
tools, leading to fragile, hard‑to‑validate manifests that drift over time.

The result? A monolithic repo full of brittle YAML that breaks at deployment. Teams use Helm,
Kustomize, or custom Python scripts, but validation still happens at runtime, creating a painful
"write → validate → deploy" cycle. When was the last time you updated a Helm values file to realise
after deployment that the change has no effect because you have a typo in the YAML structure and
Helm silently ignored the entire thing? Or even better: you created a Kustomize patch that lead to
an invalid Kubernetes resource definition, leading to a
[ArgoCD](https://argo-cd.readthedocs.io/en/stable/) sync failure?

I have seen this firsthand on a project. We use Go templating in ArgoCD ApplicationSets with `dig`
expressions for lookups and default values. However, as our platform definition is pure YAML, we
felt the need to introduce [CUE](https://cuelang.org/) for schema validation and custom Python
scripts to ensure `dig` expressions resolve. At this point, we are using more than three complex
technologies just create abstractions in a relatively safe manner.

KCL tackles this head‑on. It "compiles" KCL source files into plain YAML. While doing so, it
validates schemas, enforces constraints, and guarantees correct abstraction usage.

<!-- more -->

# Why KCL Changes the Game

KCL's compiled, constraint‑based model shifts everything from runtime to compile time. Unlike Python
or [HCL](https://github.com/hashicorp/hcl), constraints are enforced during compilation of KCL
source files, guaranteeing deterministic behaviour across environments. You therefore benefit from:

- **Early error detection**: no surprise failures at deploy time. KCL validates the Kubernetes
  resources it would output before you get to see any YAML.
- **No manual templating**: no juggling Helm values or Jinja syntax. KCL does not feel like a "hack"
  that was slapped on top of YAML.
- **Strong typing & schema enforcement**: reduces drift and copy‑paste mistakes. KCL is a strongly
  typed language providing a powerful development environment.

Compared to CUE or HCL, KCL delivers the same safety plus a simpler, more expressive syntax and
tighter GitOps integration.

# Catching Bugs Before They Bite

By validating at YAML generation, KCL removes the classic issue of:

1. Write YAML with little guidance about correctness.
2. Validate it against a schema if you are lucky enough to actually have a pipeline doing this.
3. Deploy and hope everything will work.

From what I have seen, projects tend to not have such a step 2 when it comes to infrastructure
automation on Kubernetes:

- Helm charts are not templated to ensure their output are valid Kubernetes manifests,
- Kustomize is only ever executed by ArgoCD/[FluxCD](https://fluxcd.io/) and thus never validated to
  work before deployment,
- Constraints on deployed objects are only validated by policy engines running as Kubernetes
  validating webhooks. Developers resort to "test-deploy" resources to see if they pass validation.

Comparing KCL with traditional YAML validation:

## KCL:

```kcl,linenos
# services.k
_MAX_CPU = 4
_MAX_MEMORY = int(6Gi)

schema Service:
    name?: str
    image: str
    proto: "TCP" | "HTTP" = "HTTP"
    cpu: float
    memory: int

    check:
        cpu <= _MAX_CPU and memory <= _MAX_MEMORY

services = [Service {
    name: "web"
    image: "nginx:latest"
    cpu: float(500m)
    memory: int(256Mi)
}] # This will output validated YAML when running `kcl services.k`.
```

## Traditional (YAML + [Rego](https://www.openpolicyagent.org/docs/policy-language)):

You start with YAML:

```yaml,linenos
# services.yaml
services:
- name: web
  image: nginx:latest
  proto: HTTP
  cpu: 0.5
  memory: 268435456
```

Validation happens downstream, requiring complex Rego rules and still allowing the YAML to exist
before errors surface.

```rego,linenos
# validate.rego
package main

GI := (1024 * 1024) * 1024
MAX_CPU := 4
MAX_MEMORY := 6 * GI
VALID_PROTOCOLS := {"TCP", "HTTP"}

deny contains msg if {
    some i
    service := input.services[i]
    service.cpu > MAX_CPU
    msg := sprintf("Service '%v' exceeds CPU limit: got %v, max %v", [service.name, service.cpu, MAX_CPU])
}

deny contains msg if {
    some i
    service := input.services[i]
    service.memory > MAX_MEMORY
    msg := sprintf("Service '%v' exceeds Memory limit: got %v, max %v", [service.name, service.memory, MAX_MEMORY])
}

deny contains msg if {
    some i
    service := input.services[i]
    not VALID_PROTOCOLS[service.proto]
    msg := sprintf("Service '%v' has invalid protocol: %v", [service.name, service.proto])
}
```

Compare the two approaches and notice how simple the KCL approach is. If we were to write a
`Service` that does not conform to the constraints, KCL would fail early and not even generate any
YAML. Only valid YAML can therefore reach a system such as Kubernetes. Moreover, thanks to KCL's
development ecosystem, its LSP will provide feedback straight in the IDE on most mistakes:

{{ figure(src="/img/kcl/ide-diagnostics.webp",
          caption="The LSP catches that I try to use a float for an integer field.",
          caption_style="font-weight: bold; font-style: italic;",
          style="border-radius: 8px;") }}

But KCL also offers other benefits...

# Data Modelling Made Simple

KCL also supports lambda functions. This enables developers to define a schema for a high level
abstraction and then leveraging functions to translate the abstraction into a detailed platform
definition. The lambda function encapsulates both the platform complexity and central constraints
that need to be applied across the concrete instances of the abstraction. Thus, downstream
developers can focus on high level abstractions without having to worry about either the platform,
or the constraints.

On top of this, using such abstract data models enables upstream platform engineers to keep
different "translation layers" as lambda functions. These can then be used to translate the
abstractions to different target platforms or environments. For instance, imagine having such a
function to translate your abstract representation to your production Kubernetes platform, and
another to translate it to a Docker compose file for local debugging of the application!

# Speed and Scale

A single pass compiler, incremental evaluation, and aggressive caching mean that a repo with >30,000
services compiles in ~3 seconds on a modest laptop. This is faster than Helm or Kustomize templates,
with zero runtime overhead on the cluster. While this speed might seem irrelevant, it becomes
central when considering sizable platform setups where large amounts of changes are continuously
pushed. The compounding effect at scale is not to be underestimated.

Does it pique your interest? Do you want to give KCL a try?

# Gradual Adoption

Switching your entire infrastructure management stack to KCL is probably not the way to go. You will
want to adopt it in small steps.

You can start right where you are:

1. Gradually start writing schemas and only validate your existing YAML against these schemas with
   `kcl vet`.
2. Start moving some YAML manifests to KCL to render them. This can be done either in your CI, or
   even using ArgoCD/FluxCD plugins to have your CD sync KCL just like Helm or Kustomize.
3. Where necessary, adopt SDKs to embed validation in your pipelines of choice.

Start by validating a single service; scale gradually without a full rewrite.

# How KCL Stacks Up

So how does it really stack up against other technologies?

| Feature                     | KCL     | Helm   | Kustomize | CUE     | HCL    |
| --------------------------- | ------- | ------ | --------- | ------- | ------ |
| Strong typing               | ✅      | ❌     | ❌        | ✅      | ❌     |
| Explicit schemas            | ✅      | ❌     | ❌        | ✅      | ❌     |
| Compile‑time validation     | ✅      | ❌     | ❌        | ✅      | ❌     |
| GitOps integration (ArgoCD) | ✅      | ✅     | ✅        | ❌      | ❌     |
| Community & tooling         | Growing | Mature | Mature    | Growing | Mature |

Technically, KCL can replace all the other technologies in the table above. Its biggest contender is
CUE, which offers similar promises. KCL uses a simpler and more flexible constraint language
compared to CUE, better performance, and much simpler handling of lambdas for data abstractions.
Nonetheless, CUE supports most of KCL's feature-set. In my modest opinion, you probably do not want
to replace Helm, simply because you likely rely on upstream Helm charts which do not provide
upstream KCL support.

However, in the case of the project I talked about at the beginning of this article, we could use
KCL to replace:

- CUE and Python for validation,
- Go templating in ArgoCD (by using the KCL plugin),
- and even the few remaining Kustomize snippets that we still rely on.

Replacing three technologies by a single, easier to use one is a win in my books.

# Your next Step

The next time you encounter a pain point with YAML (which ought to be soon), consider how KCL could
have mitigated this. Give it a try, and see for yourself how it can provide the level of stability
and correctness that should be required for critical platform configuration. Once you play with it a
little, you will see not only how it will improve the trust in your changes, but the potential data
abstractions have for easier platform usage for your downstream developers!
