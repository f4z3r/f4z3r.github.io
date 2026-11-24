+++
title = "Agentic Factory: Giving AI Agents Superpowers Without Giving Them the Keys"
date = 2026-11-24

[taxonomies]
tags = ["ai", "platform-engineering", "devops", "gitops"]

+++

{{ banner(src="/img/agentic-factory/banner.webp",
          alt="A secure gateway as the central building block between agents and capabilities.",
          size="width:100%;height:300px;",
          style="margin:-9% 0") }}

AI coding agents have become ridiculously capable. Give them access to a repository and they can
navigate code, implement features, run tests, and debug issues with surprisingly little
intervention.

But as I started using agents more extensively, I ran into a problem: **the more useful I wanted my
agent to be, the more access I had to give it.**

Sure, having an agent modify some code is great. But what if it could also inspect my Kubernetes
clusters, investigate an ArgoCD deployment, search our Confluence documentation, or look up related
Jira issues?

Suddenly, I'm handing an autonomous process access to a whole bunch of systems, potentially with the
same privileges I have. Considering that agents can execute arbitrary shell commands and are
susceptible to prompt injection, that doesn't sound like a particularly good idea. On top of that,
while I might have write access to Kubernetes clusters, I know to use GitOps and thus not modify
Kubernetes resources directly unless in the utmost emergency. Does my agent also know this, and do I
trust it to not perform changes on the clusters I have access to?

<!-- more -->

The core issue isn't capability, it's **control**. I want my agents to be powerful, but I want to
decide exactly what they can touch, what they can discover, and what they are allowed to change.

So I started building [Agentic Factory](https://github.com/f4z3r/agentic-factory): a small,
self-hosted environment that lets me run powerful coding agents without giving them credentials to
the systems they interact with.

## The Idea: Separate Capabilities from Credentials

The fundamental principle is simple: **an agent shouldn't need credentials to use a capability.**

Control works in two directions. First, I control what the agent can discover and invoke, through
policy, not through the agent's own judgment. Second, I control what the agent can reach, through
network boundaries, not through hope. Instead of giving an agent my Kubernetes configuration, Jira
token, and inference API keys, I want it to interact with services that expose only the operations I
explicitly allow.

This led me to an architecture with three main components:

- Sandboxed agents: I use [Pi](https://pi.dev), running in disposable rootless Podman containers.
  Each agent gets access to its project workspace, development tools, and the internet, but no
  provider credentials or privileged host access.
- A central gateway: [agentgateway](https://agentgateway.dev/) handles inference routing, MCP
  federation, credentials, policies, and observability. Every agent talks to the same gateway.
- Dedicated MCP servers: Kubernetes, ArgoCD, Jira, and Confluence integrations run as separate
  containers. They hold the credentials required to access their respective systems and are
  reachable through the gateway, not directly from the agent containers.

The resulting architecture looks something like this:

{{ figure(src="/img/agentic-factory/architecture.webp",
          caption="Network an capability isolation is the key.",
          caption_style="font-weight: bold; font-style: italic;",
          style="border-radius: 8px;") }}

Everything is managed through Podman Compose. I can have multiple agents running simultaneously
against different projects, all sharing the same infrastructure.

### Agentgateway Enforces the Control Plane

The piece that makes this particularly interesting is agentgateway. It is the control point through
which every agent interaction flows.

On the inference side, it exposes a unified API for different providers, including OpenRouter and
internal OpenAI-compatible inference services. Provider credentials stay in the gateway rather than
being distributed to every agent.

On the tooling side, it federates multiple MCP servers into a single endpoint. But more importantly,
it lets me define which tools an agent is actually allowed to discover and invoke, and which it
never even sees.

For example, I can use CEL policies to allow Kubernetes resource inspection while preventing
resource deletion or modification. The policy is enforced by the gateway, not by the agent's own
instructions: even a successfully prompt-injected agent cannot invoke a disallowed tool.

```yaml
mcpAuthorization:
  rules:
    - >-
      mcp.tool.target == "kubernetes" && mcp.tool.name in [
        "resources_list",
        "resources_get",
        "pods_log"
      ]
```

The agent doesn't even discover the tools excluded by the policy.

Of course, this is not sufficient on its own. The Kubernetes identity used by the MCP server should
also have restricted RBAC permissions. Similarly, ArgoCD and Atlassian should use appropriately
scoped credentials.

**Security should be enforced by the systems providing the capabilities, not just by the agent's
instructions.**

Beyond authorization, agentgateway also provides request guardrails that inspect and mutate tool
arguments and results in flight. I use builtin guardrail processors to automatically mask sensitive
data such as email addresses, phone numbers, and API keys before it ever reaches the model. You can
also scrub secrets or other data from tool responses before they return to the agent.

Agentgateway also provides centralized logging and analytics, which makes understanding model usage
and troubleshooting requests considerably easier.

### Why agentgateway?

There are quite a few AI gateways out there, such as LiteLLM, Kong, or Envoy AI Gateway. So why
agentgateway?

Again, I like keeping things simple. Agentgateway does everything I need, without introducing a ton
of additional complexity.

It supports inference routing, MCP federation, authentication, authorization policies, and
observability, all in a single lightweight gateway. It's incredibly fast, easy to deploy, and
doesn't require an entire infrastructure stack around it.

What I particularly like is its declarative configuration with hot reloading. Everything is defined
in YAML, and changes are picked up automatically. No restarts, no API calls, no clicking through a
UI. Just update a file.

And the cherry on top? SQLite support for analytics and request logging. No need to deploy and
maintain a separate PostgreSQL instance just to get some basic observability.

For a personal setup like mine, that's pretty much perfect. All the capabilities I need, very little
operational overhead, and everything can be managed through Git.

## Sandboxed, But Still Useful

One thing I didn't want was to make the sandbox so restrictive that it becomes useless for actual
development. Control is only useful if the agents can still do their jobs.

My projects use [mise](https://mise.jdx.dev/) to manage tooling. An agent needs to run
`mise install`, download dependencies, execute builds, and occasionally install additional system
packages.

Consequently, my Pi containers have internet access and even passwordless `sudo` inside the
container. They run under rootless Podman, so becoming root inside the container does not mean
becoming root on my machine.

Project directories are mounted read/write, with UID/GID mappings ensuring files created by the
agent have the correct ownership on the host.

This is a deliberate trade-off. The sandbox isn't a perfect security boundary: agents can still
access mounted project files, communicate with public services, and potentially reach internal
addresses accessible from the host. But they don't inherit my host credentials or directly access
the dedicated MCP containers through their Podman networks.

For my development workflow, that's a useful balance between autonomy and control.

Starting the infrastructure is as simple as:

```bash
podman compose up -d
```

And launching another agent against a project:

```bash
PI_WORKSPACE="$PWD" \
  podman compose \
    -f /path/to/agentic-factory/compose.yaml \
    --profile agent \
    run --rm pi
```

Of course I have a `pi` alias for this command.

### Why Pi?

There are plenty of great coding agents out there, such as [OpenCode](https://opencode.ai/) or
Claude Code. So why Pi?

I like Pi's philosophy: **do one thing, do it well, and don't add complexity unless you need it.**
Pi is intentionally minimal, it provides the essentials for coding with an LLM, without elaborate
planning workflows, built-in sub-agent orchestration, or complex permission systems. If I need extra
functionality, I add it through extensions rather than working around a framework that already made
those decisions for me.

This matters for control because **simpler systems are easier to secure and to reason about**. Every
moving part is a place where trust can break down, so fewer moving parts means fewer things to get
wrong. Pi handles the code; agentgateway handles the control plane; Podman handles the sandbox.

## Bonus: Integrating Internal Inference with OIDC

There's another challenge I encountered at work. Our internal inference platform uses Keycloak for
authentication through the OIDC device authorization flow.

That means I can't simply configure a static API key. I need to authenticate interactively and
periodically refresh the resulting access token.

I ended up using [oidc-agent](https://github.com/indigo-dc/oidc-agent) on my host machine.

The workflow is straightforward: I authenticate once through Keycloak's device flow, and oidc-agent
manages the encrypted credentials and refresh-token lifecycle. A small host-side script periodically
obtains a valid access token and writes it to a local file.

That file is mounted read-only into agentgateway, which supports file-backed credentials:

```yaml
auth:
  key:
    value:
      file: /run/inference-tokens/access-token
```

Agentgateway picks up changes to the token file without requiring a restart.

This means I can use my organization's inference models through the same gateway as OpenRouter,
without giving my agents access to Keycloak tokens or requiring a custom authentication proxy. The
agentgateway itself knows nothing about Keycloak, the authentication flow, or even the refresh
token. It only sees a token that gets updated from time to time.

This is an optional addition specific to my environment, rather than a requirement for Agentic
Factory itself.

## What's Next?

The setup works well for my current needs, but there are a couple of things I'd like to improve.

Better network isolation. Currently, agents can access the public internet directly. Ideally, I'd
introduce egress controls that allow downloads and package installations while preventing direct
access to internal infrastructure. That would make the gateway a stronger boundary for privileged
operations.

Human approval for sensitive operations. Read-only access is a good starting point, but occasionally
I want an agent to do more than inspect a system. Having an approval mechanism for operations such
as triggering an ArgoCD synchronization or modifying a Jira issue would be an interesting next step:
moving from "read by default" to "write by approval."

And finally, I'd like to make the whole environment more portable, so I can run the same setup not
only on my laptop but also in my remote Kubernetes environment.

## Give It a Try!

I published the entire setup here:

[github.com/f4z3r/agentic-factory](https://github.com/f4z3r/agentic-factory)

It's built around Pi, agentgateway, and rootless Podman, with MCP integrations for Kubernetes,
ArgoCD, and Atlassian. The repository contains the Compose configuration, sandbox definition, and
configuration needed to get started.

It's certainly not a complete security solution, and there are still improvements to make. But I
think the underlying idea is important: **as agents become more autonomous, we should spend at least
as much time thinking about how we grant them capabilities as we spend making them more capable.**
Control isn't something you bolt on after the fact, it's the foundation everything else is built on.
