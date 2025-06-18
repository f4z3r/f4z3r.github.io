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
