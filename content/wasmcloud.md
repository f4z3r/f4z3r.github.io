+++
title = "WasmCloud: an intro"
date = 2025-06-18

[taxonomies]
tags = ["wasm", "cloud", "rust", "kubernetes"]

+++

{{ banner(src="/img/wasmcloud/assembly-line.jpeg",
          alt="An assembly line with robot arms.",
          size="width:100%;height:300px;",
          style="margin:-7% 0") }}

WebAssembly was initially designed to help run high performance applications in the web browser.
While some thought this might lead to the replacement of JavaScript in the frontend world, this has
not yet proven to be the case. Instead, WebAssembly has been used to facilitate the development of
plugins and composable software, especially in environments where re-usability and performance play
a key role. And thus WebAssembly has also found its place in the world of application runtimes. In
this blog post, I will dive deep into wasmCloud. wasmCloud is to WebAssembly what Kubernetes is to
Docker: a software orchestrator that enables the deployment, scaling, and lifecycle of complex
WebAssembly payloads.

<!-- more -->

A few years ago, I stubbled into WebAssembly by pure chance. Rust was one of the first languages to
support WebAssembly as a compilation backend, and I am a huge Rust fanboy. That is how I first heard
of this new technology. As it was mostly marketed as a frontend technology and alternative to
JavaScript and I am not a frontend developer, I did not further investigate this too much. However,
in the least year, WebAssembly has popped up here and there in completely different contexts.
Whether it be to support implementing plugins in different languages, or as a runtime with little to
no cold-start delays for serverless computing. I became intrigued...

Over the last few months I decided to dive deep and try to contribute to the open source wasmCloud
CNCF incubating project. The project is written in Rust, a language I absolutely love and would like
to work more with, and touches on aspects I am both very familiar with (orchestration) and utterly
unfamiliar with (WebAssembly). In this post I want to share an introduction to wasmCloud, from the
basics up to a fully running application. This blog post will start with the basics, and does not
assume that you are familiar with WebAssembly or other technology other than Rust for the examples.
Familiarity with Kubernetes will definitely help though.

Addressing:
- proud of: contributed and got stuff to work
- pained: understanding the whole stuff is difficult
- passionate: wasm

# Key Questions

- Who do you want to read this? Developers and architects that want to learn more
- What do they know about what you're planning to write? Very little, some rust, and some of what
  webassembly is
- Why do they care about what you're planning to write? because it is a cool piece of tech that is
  quite novel and has a lot of potential
- Why should they care about your perspective? I have made quite a lot of experience with it
- What do you want them to do differently or think about differently after reading your blog post?
  try it out

# WebAssembly

- compilation backend
- supported by languages x y z
- performance
- sandboxing

# wasmCloud Architecture

see: https://wasmcloud.com/docs/concepts/

## what is it and why use it vs kubernetes

- components have structure imports and exports: can be linked to together much easier. Docker images/containers
  don't have a programatically defined interface. Rely on OpenAPI specs or similar.
- much better security model than kubernetes
- lacking the extensible api that makes kubernetes so powerful

## Hosts

wasmCloud hosts are the foundation of the compute platform that is provided. They are the equivalent
of Kubernetes nodes and provide a WebAssembly runtime for components to run on. Just as with
Kubernetes nodes, application developers will rarely need to worry about the hosts other than for
deployment affinities and the like.

## Lattice

The lattice is a service mesh that interconnects the wasmCloud hosts and thus also the applications
and providers that will run on these hosts. It can be seen as the networking layer, or rather the
CNI implementation of Kubernetes. The wasmCloud lattice is implemented using NATS. Under the hood
components call each other using wRPC and any component that exposes a function essentially becomes
subscriber to a queue on NATS for this function. This is what enables high availability, as
instances of the same component listen to the invocation.

## wadm

The wasmCloud Application Deployment Manager (wadm) manages the declarative application deployments.
It leverages the Open Application Model (https://oam.dev/). It can be seen as a hybrid between the
deployment controller on Kubernetes and the API server.

## Capability

An abstract interface, such as KV store.

## Providers

Implementation of the capability above.

Plugins on hosts that are hot-swappable. They should represent any capability that is not directly
business logic. External that run external to the hosts somewhere on the lattice. And internal ones
that are backed into the hosts themselved, such as logging or randomness.

## Interfaces

WIT interfaces to declare on what interfaces you rely and which you provide.

## Components

The actual module that you want to deploy.

## Applications

Combines all the above into a deployable unit (think helm chart?)


Over the past few months I have invested some time to contribute to an open source project I find
fascinating: [wasmCloud](https://wasmcloud.com/). As a platform engineer and architect, I am very
familiar with how software platforms are typically built in practice. However, with the ubiquity of
Kubernetes, you run the risk to being stuck in the "doing it the Kubernetes way" line of thinking.
But then again, are there any better ways? This is where wasmCloud caught my attention. A modern
platform building on proven concepts from Kubernetes, but with some significant differences. In this
article I want to introduce wasmCloud, how it compares to Kubernetes, what its internal architecture
looks like, and what ideas are, in my humble opinion, a step up from "the Kubernetes way of things".

<!-- more -->

Before getting started, I need to get some things out of the way. This article will make quite a few
comparisons to Kubernetes and bytecode interpreters like the JVM. If you are unfamiliar with these
technologies, it might make sense to have a short look at what these are. Considering you clicked on
this article, I am however guessing that you are familiar with them and have some experience in
platform engineering practices, either as a poweruser of a platform, or as a designer and developer
of one.

Moreover, I want to thank the company I work for, [ipt](https://ipt.ch/en/), for allowing me to
invest time to learn about new technologies such as wasmCloud. Not only is contributing to open
source a great way to pay back a community powering the modern world, it is also a huge passion of
mine. Being able to help the development of such projects during paid worktime enables me to learn
so much on emerging technologies, and maybe help build the revolutionary tools of tomorrow.

So... wasmCloud!? I have been interested in WebAssembly ever since it promised to replace
JavaScript, a language I personally consider as extremely poorly designed (someone once told me it
was designed in three days, so no wonder there). While WebAssembly is very far from doing anything
close to replacing JavaScript in the browser, it has evolved into something else: a potential
replacement for containers.

# WebAssembly as a Platform Foundation

Modern platforms nearly all build on top of containers as their foundational element to run
executable code. This is a logical evolution from Docker meteoric growth, and the ecosystem that
grew around its open standards (such as the [OCI - Open Container
Initiative](https://opencontainers.org/)). While containers provide a huge step in terms of ease of
use, standardization, and security compared to shipping raw artefacts to virtual machines, as was
the case before them, they do have some shortcomings.

First and foremost, containers are not composable. In part due to their flexibility, they do not
offer standard ways of expressing how the world should interact with them at runtime, or what they
rely on to perform their functionality. This means that containers are typically deployed as REST
based microservices, where containers communicate with one another over a network using APIs agreed
upon outside of the container standards. This lack of standardization makes building reusable
components more challenging than it has to be. Moreover, each container essentially needs a
server, authentication, authorization, and more to run. This results in quite some waste in the
compute density of the platform, with lots of compute wasted on boilerplate.

Moreover, while containers are a huge step in the right direction in terms of security, they are not
quite as secure as most people are led to believe. Containers are "allow by default" constructs,
which take quite some work to properly harden.

Finally, due to how containers are typically built, their startup times are not that great. It is
not abnormal to see container start times in the dozens of seconds. This does not bother people very
much because containers are mostly used to run long running processes (since we need these REST APIs
everywhere). However, a large part of containers are mostly idle, waiting for some API request to
come in. If one considers that workloads could be called (and thus the process started) only when
needed, startup times over 100ms is considered slow.

This is where WebAssembly comes it. WebAssembly addresses these challenges. Composability is
addressed by the component model.

## WebAssembly: The Component Model

The [component model](https://component-model.bytecodealliance.org/) is a way that WebAssembly
modules can be built with metadata attached to them which describe their imports and exports based
on a rich time system. Moreover, they are composable such that a new component can be built from
existing components as long as the imports of one are satisfied by the exports of another. This
means that components can interact with one another via direct method/function calls, whose
specification is fully standardized. This interface specification is declered in a language known as
the WebAssembly Interface Types (WIT) language. An example of a WIT specification of a component
relying on a clock system can be seen below:

```wit
package wasi-example:clocks;

world mycomponent {
    import wall-clock;
}

interface wall-clock {
    record datetime {
        seconds: u64,
        nanoseconds: u32,
    }

    now: func() -> datetime;

    resolution: func() -> datetime;
}
```

This declaration says that the component relies on an interface `wall-clock` (it `import`s the
interface) which defines two functions: `now` and `resolution`. Both take no arguments and return a
`datetime` object consisting of a `seconds` and `nanoseconds` field. This component could then be
composed with any other component which exports this `wall-clock` interface.

If this were a container which would rely on accessing some API, we would need to read a
non-standardized documentation of the container image, and then read up on other containers to
ensure they provide APIs that match the ones called by the first container.

The WebAssembly component model can essentially be seen as a form of contract-based programming to
formalize interfaces between WebAssembly core modules.

The components One can imagine the component model as an evolution to how JARs
can be called in JVM based programs, regardless of the language that was used to generate the JAR.

# Goal

> based on repo: https://github.com/f4z3r/wasmcloud-tutorial

devbox shell

build using https://docs.potterdb.com/apis/rest in backend

## difference to kubernetes


# Create Kubernetes Cluster

We will deploy wasmCloud on Kubernetes

```bash
kind create cluster -n wasmcloud --config ./assets/kind-config.yaml
# and deploy an ingress
kubectl apply --filename https://raw.githubusercontent.com/kubernetes/ingress-nginx/master/deploy/static/provider/kind/deploy.yaml
```

# install the operators

```bash
# install NATS, wadm, and the operator
helm upgrade --install \
  wasmcloud-platform \
  --values https://raw.githubusercontent.com/wasmCloud/wasmcloud/main/charts/wasmcloud-platform/values.yaml \
  oci://ghcr.io/wasmcloud/charts/wasmcloud-platform:0.1.2 \
  --dependency-update

# update to get host, cnnot be done in one because of missing CRDs
helm upgrade --install \
  wasmcloud-platform \
  --values https://raw.githubusercontent.com/wasmCloud/wasmcloud/main/charts/wasmcloud-platform/values.yaml \
  oci://ghcr.io/wasmcloud/charts/wasmcloud-platform:0.1.2 \
  --dependency-update \
  --set "hostConfig.enabled=true"
```

At this point you should have the following components running:
- NATS: a pub-sub STS taking care of communication within the wasmCloud cluster.
- wadm: the "management API" of wasmCloud managing applications and deployments (wasm Appliation Deployment Manager)
- wasmcloud-operator: the operator allowing to configure wadm using Kubernetes CRDs.
- a wasm host: a single host that will run your applications (similar to a kubernetes worker node).

# configure wash

Setup the required port forwards for the CLI to work:

```bash
kubectl port-forward service/nats 4222:4222 4223:4223
```

Run the UI using `wash ui`

## deploy an application

You can find an application declaration under `assets/`.
```sh
kubectl apply -f ./assets/hello-world.yaml
```

Then you can check that the application is running:
```sh
kubectl get application
```

This should return that the application is deployed after a short while.

Port-forward to the host to access the component:
```sh
kubectl port-forward \
    "pods/$(kubectl get pods -l 'app.kubernetes.io/instance=wasmcloud-host' -o json | jq -r '.items[0].metadata.name')" \
    8000
```
And access the application under [http://localhost:8000](http://localhost:8000).

> **NOTE:** you cannot create the port-forward in k9s.


## accessing application via ingress

Deploy the ingress routing to the service generated by the wasmCloud operator:
```sh
kubectl apply -f ./assets/hello-world-ingress.yaml
```

Once this is synced, you can access `http://example.com:8080/hello` to get a response (assuming you have your hosts
file setup properly).


## using wash cli

You can use wash to access the UI as shown above, or using commands such as `wash get inventory` to get information
on the hosts and what is running on them.


# notes

- uses OAM specification to define applications: [https://oam.dev/](https://oam.dev/)
- Very easy installation via Nix.
- Language support for Go, Typescript and Rust.


# building app

Test with

```bash
wash dev
```


Added persistency etc

# links

- Documentation of concepts: [https://wasmcloud.com/docs/concepts/](https://wasmcloud.com/docs/concepts/)
- Documentation for deploying wasmcloud on kubernetes: [https://wasmcloud.com/docs/deployment/k8s/](https://wasmcloud.com/docs/deployment/k8s/)
- Documentation for running wasmcloud on kubernetes: [https://wasmcloud.com/docs/kubernetes/](https://wasmcloud.com/docs/kubernetes/)
- Documentation to build components: [https://wasmcloud.com/docs/developer/languages/rust/components/](https://wasmcloud.com/docs/developer/languages/rust/components/)
