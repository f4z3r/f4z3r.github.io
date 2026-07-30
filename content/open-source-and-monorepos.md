+++
title = "Why Is No One Talking About Repository Structure?"
date = 2026-07-30

[taxonomies]
tags = ["open-source", "devops", "architecture"]
+++

{{ banner(src="/img/monorepos/multi-repo-vs-monorepo.webp",
          alt="Dependent repositories versus a single monorepository.",
          size="width:100%;height:300px;",
          style="margin:-10% 0") }}

Over the last couple of months, I have been more involved in contributing to open source again.
Helping maintainers improve their products is such a rewarding and eye-opening experience. It is an
opportunity to learn how others solve complex problems and work on projects that tend to be
significantly more mature than most enterprise software regarding engineering practices and
automation.

I was quite hyped when assigned a task to implement a small feature with actual end-user impact. It
was nothing fancy: essentially, adding a flag to a CLI command to slightly modify user-facing
behavior.

<!-- more -->

So, I started by implementing the functionality change in the core system. Having updated the core,
it quickly became apparent that the change needed to propagate to the internal API that the core
exposes. That API then needed to be called by an SDK. Updating that was trivial, as it is a
statically generated SDK.

Once I made the changes to expose the new functionality in the SDK, I realized the CLI didn’t use
the generated SDK directly. Instead, it relied on a wrapper SDK that provided convenience features
and a more idiomatic developer experience.

I therefore updated the wrapper SDK, and finally modified the CLI to add the flag and invoke the new
method. Done!

# The Multi-Repo Tax

I am not questioning the architecture of exposing functionality via two layers of SDKs called by a
CLI. In fact, for the project I was working on, this design made complete sense. The real pain point
was that to implement this tiny feature, I had to execute an entire release process for the core
system, the bare-bones SDK, and the wrapper SDK, touching a total of four repositories.

All this friction just to add a single flag to a CLI!

# The Price of Cascading Releases

Because every component in the project released versioned artifacts used downstream, introducing
this small feature required a tedious release cascade:

1. Release a new version of the core system.
2. Update the raw SDK repository dependency and publish a new raw SDK release.
3. Update the wrapper SDK repository dependency and publish a new wrapper SDK release.
4. Update the CLI repository dependency to finally implement the flag.

And what if I then realized I made a conceptual error in the core? I would have to replay the entire
multi-repo release game from scratch.

Friends never fall short in telling me that I have a proclivity to care about engineering practices
many consider pointless or overkill. Unsurprisingly, I jumped onto the monorepo vs. multi-repo
bandwagon when I first heard about it. While there is no silver bullet regarding repository
boundaries, I find it baffling how rarely people evaluate how repositories are shaped. Engineers and
architects can debate software design patterns and architectural principles for weeks, yet no one
loses a second's thought to repository layout. Why is that?

# Unlocking Atomic Velocity with Monorepos

You can mitigate this friction in multi-repo setups by following unpinned branches rather than
versioned dependencies, but that introduces dangerous build brittleness (such as silent upstream
breaks).

A simpler, proven alternative is consolidating these components into a single repository. A monorepo
enables you to test the entire dependency chain without publishing intermediate releases. Downstream
components simply reference the latest commit. Developers get immediate feedback if an upstream
change breaks a downstream contract, and changes can be made atomically across component boundaries
in a single pull request.

# Real-World Impact: Enterprise Consolidation

Ironically, repository layout is something I have held close to my heart for quite some time (see my
[previous post on using monorepos for infrastructure management](../a-comprehensive-guide-to-managing-large-scale-infrastructure-with-gitops)).
I am proud to say this is one of the rare instances where the enterprise projects I work on are
further along than the open-source tooling I contribute to.

Over the last 18 months, we made a concerted push to consolidate repositories in my primary mandate.
Not only did we drastically reduce repository count, making code discovery effortless for new
joiners, but we also eliminated massive developer friction. Where developers previously had to
coordinate three or four inter-dependent PRs, a single PR now suffices.

Crucially, we still release components individually when other teams require access to our
frameworks. Internally, however, we are no longer trapped in hyper-frequent micro-releases just to
consume our own updates. This holds true whether managing application code or GitOps infrastructure
configurations.

# The Catch: CI Complexity

Monorepos are not without trade-offs. They require a significantly higher upfront investment in
continuous integration logic. As the codebase grows, running your entire build and test suite on
every commit becomes unsustainable.

Instead, you must implement intelligent change detection to run CI pipelines selectively based on
modified paths, a task far more complex than most anticipate. Fortunately, because companies like
Google, Meta, Uber, and X have leveraged monorepos for decades, modern build tools (such as Bazel,
Nx, or Turborepo) have emerged to solve these exact scaling challenges.

# Summary

Choosing your repository strategy isn't just an administrative decision, it dictates your team's
day-to-day iteration speed. While multi-repo setups offer clean ownership boundaries, they introduce
severe release friction for tightly coupled dependencies.

If your team spends more time coordinating cascading releases than writing code, it might be time to
stop debating design patterns and take a hard look at your repository boundaries.
