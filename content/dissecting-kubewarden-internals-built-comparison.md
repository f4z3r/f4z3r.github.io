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
virtual machines. However, in oder to leverage the capabilities of the platform, these tend to host
applications from various tenants. This introduces a strong need for properly crafted controls and
well-defined compliance to ensure the tenants use the platform correctly and do not affect one
another. The RBAC capabilities provided out of the box by Kubernetes are quickly insufficient to
address this need. This is where policy engines such as [Kubewarden](https://www.kubewarden.io/)
come into play. In this post we will look at how Kubewarden can be leveraged to ensure correct usage
of a platform, how it compares to other policy engines, and how to best adopt it.

<!-- more -->

# Policy Engines

Kubernetes provides role-based access control (RBAC) out of the box to control what actions can be
performed against the Kubernetes API. Generally, RBAC works by assigning sets of roles to users or
groups of users. Capabilities are attached to these roles, and users having a role obtain these
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
no possibility to represent more complex logic. Controlling the configuration of the pods created by
a `Deployment` is a validation of the payload pushed to the API, and is thus not supported either.

> **Note:** Security contexts and resources on pods can be controlled via methods such as Security
> Context Constraints or Pod Security Policies and ResourceQuotas. However, these do not reject the
> creation of the deployment, but will only block the creation of the pods themselves. It is
> therefore possible to apply a Deployment that is known to not allow the creation of pods. In my
> personal opinion this is not ideal, as it does not fail early.

These scenarios is where policy engines come into play. They utilise Kubernetes' Dynamic Access
Control mechanisms to enable cluster administrators to manage permissions using more complex logic.
The exact capabilities of policy engines can vary greatly as these are essentially arbitrary
software that validates or mutates Kubernetes requests. However, the majority of major policy
engines work similarly. They tend to implement the operator pattern, enabling the configuration of
policies using Kubernetes custom resources. In this blog post we will have a look at Kubewarden in
more detail, and how it compares to other engines.

# Kubewarden Architecture

Kubewarden leverages [WebAssembly (WASM)](https://webassembly.org/) to enable extremely flexible
policy evaluation. Essentially, Kubewarden can be seen as a WASM module orchestrator where policies
are deployed as serverless functions that get called when necessary. The result of these WASM
functions then determines whether an API request against Kubernetes is allowed, denied, or altered
(mutated).

This similee can also help explain Kubewarden's architecture. Essentially, the Kubewarden controller
(operator) manages policy servers and admission policies. Policy servers can be seen as hosts for
the serverless execution of functions, whereas admissions policies are the functions themselves.
Therefore, in order to perform policy validation, one needs at least one policy server running to
host the policies one wants to enforce. The controller then takes care of configuring the runtime
(policy server) to properly run the adequate policy executable with the appropriate inputs when a
policy needs to be evaluated. The diagram below illustrates this:

{{ image(src="/img/kubewarden/policy-server.excalidraw.svg",
         alt="A policy server's internal architecture", style="border-radius: 8px;") }}

As policies are WASM modules, they can themselves support configuration. This makes policy reuse a
major feature of Kubewarden. Complex logic can be contained in the WASM module while exposing some
tuning as configuration, allowing a policy to perform a relatively generic task. To understand this
better, let us have a look at such a policy:

```yaml,linenos
apiVersion: policies.kubewarden.io/v1
kind: ClusterAdmissionPolicy
metadata:
  annotations:
  name: "cel-policy-replica-example"
spec:
  module: registry://ghcr.io/kubewarden/policies/cel-policy:v1.0.0
  backgroundAudit: true
  mode: protect
  mutating: false
  policyServer: default
  rules:
    - apiGroups: ["apps"]
      apiVersions: ["v1"]
      operations: ["CREATE", "UPDATE"]
      resources: ["deployments"]
  settings:
    variables:
      - name: "replicas"
        expression: "object.spec.replicas"
      - name: maxreplicas
        expression: int(5)
    validations:
      - expression: "variables.replicas <= variables.maxreplicas"
        messageExpression: "'the number of replicas must be less than or equal to ' + string(variables.maxreplicas)"
  namespaceSelector:
    matchLabels:
      environment: test
```

In this example, we are using a WASM module which evaluates a [Common Expression Language
(CEL)](https://cel.dev/) expression to define our policy. Evaluating a CEL expression is not
something we want to implement every time ourselves. Thankfully, Kubewarden provides this as a WASM
module on their [ArtefactHub](https://artifacthub.io/packages/search?kind=13&sort=relevance&page=1).
Thus we do not need to implement anything and can reuse that module. It is referenced on line 7
above. Of course we also need to actually define the CEL expression that should be the heart of the
policy rule. This is done on lines 18 to 25 within the `settings` block. Note how we can use object
internals (such as replicas defined in a `Deployment`) in the validation expression. Finally, we
need to define on what objects this policy should be evaluated. In order to do this, we provide
`rules` (lines 13-16) that tell Kubewarden on what Kubernetes API endpoints to trigger the policy,
and additionally provide information about which namespaces should be affected by the policy with a
`namespaceSelector` (lines 26-28). The remaining options configure the following:

- `backgroundAudit`: informs Kubewarden to report on this policy for objects that are already
  deployed. In this case, we validate the replicas on created or updated `Deployment` objects.
  However, there might already be `Deployments` on the cluster that violate the policy before we
  start enforcing it. This option will tell Kubewarden to provide reports on such violations.
- `mode`: Kubewarden supports enforcing policies (in `protect` mode), or monitoring the cluster (in
  `monitor` mode). Using the `monitor` mode can be interesting when investigating how people use the
  Kubernetes cluster or providing them with warnings before enforcing policies.
- `mutating`: policies can also mutate (change) requests. In this case we are only performing
  validation to potentially reject requests. Thus we set `mutating` to `false`.
- `policyServer`: as explained above, Kubewarden can manage many policy servers. This simply informs
  the controller on which policy server this specific policy should be deployed.

As one can see based on the sample policy above, while Kubewarden technically uses programs as
policies, it is usually not necessary to write any code to use Kubewarden. This is thanks to its
strong focus on module configuration and re-usability. The above CEL module alone already enables
the configuration of a very wide range of policies. On top of that, other modules shared on
ArtefactHub provide more specific validations or mutations that might incorporate more complex
logic. If this is not enough, policy groups (a feature we will not cover in this post) can be
utilised to combine other policies and express more complex logic as well. Finally, if one has very
specific needs that cannot be addressed by any of the publicly shared modules, one can still fall
back to writing code and building ones own module with fully arbitrary logic. How such policies can
be written, in actual code, might follow in a separate blog post.

The above architecture of Kubewarden is what makes it stand apart from most other policy engines.
Generally policy engines contain the logic fully in the controller, only exposing configuration via
the custom resource. Since Kubewarden can essentially execute arbitrary WASM bytecode, it is not
bound by the expressiveness of the custom resource declaration.

All this considered, is Kubewarden the best choice for a policy engine and should be used in all
scenarios?

# Comparison

There are many other policy engines out there, such as [Kyverno](https://kyverno.io/),
[Gatekeeper](https://open-policy-agent.github.io/gatekeeper/website/), or
[Polaris](https://www.fairwinds.com/polaris). So why would you choose Kubewarden over any other?

As explained above, Kubewarden provides unprecedented flexibility, thanks to the way it evaluates
its policies. This has the massive advantage that you will never reach a point that you have a
policy that you would like to enforce but are restricted by the policy engine itself. However, it
also has some drawbacks. The primary one being complexity. Writing WASM modules is not for the
fainthearted, as WebAssembly is not yet incredibly mature, and most developers will not be familiar
with it. The complexity issue can however be sidestepped as the vast majority of policies can be
expressed using off-the-shelf WASM modules provided by Kubewarden.

Another aspect that often needs to be considered in enterprise contexts, is support. Kubewarden is
an open source project that is loosely backed by SUSE (as it was originally developer for its
Rancher offering). Thus enterprise support is only available via a SUSE Rancher Prime. Other tools
such as Kyverno are not only more mature, but offer more flexible enterprise support (via
Isovalent).

Finally, another aspect to consider is the featureset of a policy engines. Not all policy engines
support mutating requests, and are thus much more restricted in their use. However, in this category
Kubewarden offers all the features typically desired from policy engines. Some engines such as
Kyverno support more features such as synchronizing `Secret` objects. While this can be useful, it
is, in my humble opinion, not a feature for a policy engine.

Of course, there are also personal preference aspects to consider. As an example, Kubewarden and
Kyverno handle policy exceptions very differently. Kubewarden has matchers that can be defined as
part of the policy itself, which allow to exclude some resources from being validated. Kyverno on
the other hand uses a separate CRD called [`PolicyException`](https://kyverno.io/docs/exceptions/).
Both have advantages and disadvantages.

# Verdict

Kubewarden is a very interesting piece of software. Its internal architecture enables it to be
incredibly flexible, at the cost of complexity. However, due to a smart concept of WebAssembly
module re-use, that complexity is mostly under the hood, unless one wants or needs to dive deep. In
my opinion, Kubewarden can be an absolutely great consideration when ones operates very large
Kubernetes clusters what might have quite exceptional requirements. However, even in these cases, I
would recommend starting very slow, and slowly building up to the complexity Kubewarden can hold in
store.

If you do not operate a large Kubernetes fleet, or expect to have rather standard requirements in
terms of how you want to restrict access to you cluster(s), you might be better off with more mature
and simpler tools like Kyverno. Getting support for these tools is likely to also be much simpler.

A large part of the complexity of Kubewarden also comes from all that is required to even run this
in an enterprise context. Unless you allow pulling WASM modules directly from the internet, you will
also need a registry to host OCI packaged modules. On top of that, should you decide to write your
own modules, you will need a process to do this, and build knowhow in that area. These are some of
the aspects I hope to cover in a follow up post.
