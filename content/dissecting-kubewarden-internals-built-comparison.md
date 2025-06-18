+++
title = "Dissecting Kubewarden: Internals, How It's Built, and Its Place Among Policy Engines"
date = 2025-05-03

[taxonomies]
tags = ["kubernetes", "platform-engineering", "sre", "security"]

+++

{{ banner(src="/img/kubewarden/knight.jpeg",
          alt="A knight in armor striding forward with his sword drawn.",
          size="width:100%;height:300px;",
          style="margin:-15% 0") }}

Kubernetes offers amazing capabilities to improve compute density compared to older runtimes such as
virtual machines. However, such platforms tend to host applications from various tenants to properly
leverage the capabilities of the platform. This introduces a strong need for properly crafted
controls and well-defined compliance to ensure the tenants use the platform correctly and do not
affect one another. The RBAC capabilities provided out of the box by Kubernetes are quickly not
enough to address this need. This is where policy engines such as Kubewarden come into play. In this
post we will look at how Kubewarden can be leveraged to ensure correct usage of a platform, how it
compares to other policy engines, and how to best adopt it.

-> TODO: why does my opninion matter?

<!-- more -->

# Policy Engines

Kubernetes provides role-based access control (RBAC) out of the box to control what actions can be
performed against the Kubernetes API. Generally, RBAC works by assigning sets of roles to users or
groups of users. Capabilities are attached to these roles and users having a role obtain these
capabilities. This simple mechanism is very powerful, mostly because it is quite flexible while
allowing a simple overview of a user's capabilities. However, in the case of Kubernetes, the
definition of capabilities is very restricted. Roles only allow or deny access to Kuberenetes API
endpoints, but to not allow control based on payload content. This means that these capabilities are
mostly restricted to CRUD operations on Kubernetes primitives (e.g. `Deployments`, `Ingresses`, or
custom resources). Unfortunately, this is often not enough.

For instance, it is quite common to allow users to perform actions on some primitives under
specific conditions. An example would be that creating `Deployments`s is only allowed as long as its
name follows some convention and the pods its creates are not privileged and set proper resource
requests/limits. The naming convention cannot be enforced by standard RBAC controls as these have
no possibility to represent more complex logic. Controlling the configuration of the pods a
deployment will create is a validation of the payload pushed to the API, and is thus not supported
either.

Note:
Security contexts and resources on pods can
be controlled via methods such as Security Context Constraints or Pod Security Policies and
ResourceQuotas. However, these do not reject the creation of the deployment, but will only block the
creation of the pods themselves. It is therefore possible to apply a Deployment that is known to not
allow the creation of pods. In my personal opinion this is not ideal, as it does not fail early.

These scenarios is where policy engines come into play. They utilise Kubernetes' Dynamic Access
Control mechanisms to enable cluster administrators to manage permissions using more complex logic.
The exact capabilities of policy engines can vary quite greatly as these are essentially arbitrary
software that validates or mutates Kubernetes requests. However, the majority of major policy
engines work similarly. They tend to implement the operator pattern, enabling to configure policies
using Kubernetes custom resources. In this blog post we will have a look at Kubewarden in more
detail, and how it compares to other engines.

# Kubewarden Architecture

Kubewarden leverages WebAssembly (WASM) to enable extremely flexible policy evaluation. Essentially,
Kubewarden can be seen as a WASM module orchestrator where policies are deployed as serverless functions
that get called when necessary. The result of these WASM functions then determines whether an API
request against Kubernetes is allowed, denied, or altered (mutated).

This similee can also help explain Kubewarden's architecture. Essentially, the Kubewarden controller
(operator) manages policy servers and admission policies. Policy servers can be seen as hosts for
the serverless execution of functions, whereas admissions policies are the functions themselves.
Therefore, in order to perform policy validation, one needs at least one policy server running to
host the policies one wants to enforce. The controller then takes care of configuring the runtime
(policy server) to properly run the adequate policy executable with the appropriate inputs when a
policy needs to be evaluated. The diagram below illustrates this:

-> TODO diagram on policy server arch

As policies are WASM modules, they can themselves support configuration. This makes policy reuse a
major feature of Kubewarden. Complex logic can be contained in the WASM module while exposing some
tuning as configuration, allowing a policy to perform a relatively generic task. To understand this
better, let us have a look at such a policy:

-> TODO policy CR with settings

...

The above architecture of Kubewarden is what makes it stand apart from most other policy engines.
Generally policy engines contain the logic fully in the controller, only exposing configuration via
the custom resource. Since Kubewarden can essentially execute arbitrary WASM bytecode, it is not
bound by the expressiveness of the custom resource declaration.

- comparison with kyverno and gatekeeper, polaris?

## Audit Scanner

# Compilation

- WASM and the like
- how to host wasm policies
- wasm not super mature

# Verdict


- Nice to start slow with built-in and CEL
- Can get arbitrarily complex -> quick that wasm might be simpler to understand then CEL
  (contextAware)
- Increases complexity of the platform
