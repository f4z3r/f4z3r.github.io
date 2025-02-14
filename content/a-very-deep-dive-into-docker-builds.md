+++
title = "A Very Deep Dive Into Docker Builds"
date = 2024-11-26

[taxonomies]
tags = ["docker", "sre", "python", "security"]

+++

Containers are everywhere. From Kubernetes for orchestrating deployments and simplifing operations
to Dev Containers for flexible yet reproducible development environments. Yet, while they are
ubiquitous, images are often built sub-optimally. In this post we will be looking at a full example
of a Docker build for a Python application and what best practices to consider.

<!-- more -->

> This is a real world example from an very small component we built in Python for one of our
> clients. Very few alterations were made to the original configuration (changing URLs, and removing
> Email addresses mostly). We will go in depth as to why we did every single little thing. While
> some stuff is quite Python-centric, the same principles apply to other languages, and the text
> should be broad enough so that it is understandable how to transfer this example to different
> languages.

Also, this is a long article, so if you actually plan on reading it, grab yourself a snack and a
fresh drink first.

# Goal

The goal of this post is to showcase how one can setup a Docker build that is:

- fully reproducible,
- as fast as possible,
- fails early on code issues,
- isolates testing from deployed code,
- is secure.

The example we will use for this implements quite a lot to ensure only quality code reaches
production, and that it can do so as fast as possible. Going all the way might not be necessary for
all projects using Docker. For instance, if you release code to production only once a day (or less)
you might care less about release build cache optimization. This example is however meant to show
the "extreme" to which you can push Docker, so that you can (in theory) push code to production
fully continuously (CI/CD principles). But yeah ...

{{ image(src="/img/meme.jpeg", alt="One does not simply deploy containers to production",
         style="border-radius: 8px;") }}

# Why

Why do we have these goals? Reproducible builds are one of the most important factors for proper
compliance, and for easier debugging. Debugging is simpler, since we ensure that no matter the
environment, date, or location of the build, if it succeeds, the same input generates the same
output. Moreover, it brings stability, as a pipeline might not suddenly fail on a nightly build (if
you still do such things) because a new upstream library or program was released that is used
somewhere in your supply chain.

Regarding compliance, we need to be able to tell and revert to the exact state of software that was
deployed in the past. Without reproducible builds, using Git to track back to a previous state of
deployed code does not help you much, because while you can validate what code you deployed, you
don't know what versions of everything else you deployed with it.

Builds should be fast, and fail fast. The reason here is that no one likes to wait. You don't want
to wait for 2 hours to figure out whether a tiny code change breaks tests or does not even compile.

You will want to isolate test code from deployed code, because more code equals more bugs. While
testing frameworks are very good at isolating test code from code being tested, writing tests
generates a risk of bugs. Moreover, the test code is unneeded bloat for your runtime application.
Thus it should be isolated from it.

Finally security. While some people think that containers improve security by default, this is not
the case. Container technology has the potential to indeed improve the robustness of some security
measures and controls. However, in order to achieve this, one needs to correctly utilize containers
and build the images with security in mind. For instance, if an image contains certain utilities
that allow it to connect to the internet (such as `curl` or `wget`), it suddenly makes the container
much more vulnerable to container escape attacks (where an attacker manages to move from the
container to the underlying host), and hence the whole isolation benefit of the container (which can
be a security control) is broken. The same is true for containers that contain interpreters and
allow the runtime user to open, edit and execute arbitrary files. As our container will contain
Python code, and hence the Python interpreter, this is definitely something we need to take very
seriously.

# Python Goals

Our example is based on Python, an interpreted language. This is not ideal, as it means that it does
not require a compile step. Compilation optimization is however a very important aspect in Docker
builds. In order to still address this, I will talk about this, but will not refer to the
configuration examples. One could ask why I did not take a compiled language example then. The
reason is very simple, I wanted a real world example such that this post is not just theoretical
goodness, and most Golang image builds I am currently working on are more basic and not as
educational.

Yet another question could be "why deploy Python in Docker in the first place?". This is a very
legitimate question. Python requires a lot of OS bloat to just be able to run. This means that
typically a VM is a good choice to host it. For all those saying that Docker is still better because
of performance (due to faster startup, no hardware virtualization overhead, etc): this is not true
for such cases where a large part of an OS needs to be in the Docker image. A VM of a full
init-based Linux system can be launched in less than 250ms on modern technology. A full Ubuntu
installation with systemd can be completely booted in around 2.5 seconds. The former is in the same
order of magnitude that it might take the Python interpreter to just load the code of a large Python
application.

So performance cannot be said to be better with Docker, why choose Docker then? Better reasons are
that you can strip down a Docker image much easier than an OS. This is critical for us due to
security requirements. While Python requires a lot of OS features, the majority of the OS is still
bloat. Every piece of bloat is a potential attack vector (each of these unused components might have
one or more CVEs that we need to patch, even though we don't even use that software). Another reason
is that the build process of Docker is much simpler to manage. There are tools such as
[Packer](https://www.packer.io/) that allow similar processes for VMs, but these are not as
standardized as the [open container initiative](https://opencontainers.org/) (OCI - which Docker
adheres to).

Another very important point is the ease of development. Docker and other OCI compliant products
provide us with a possibility to build, test, and run our build artefacts (in this case Docker
images) everywhere. This makes it very simple and fast for our developers to test the build and
perform a test run of an image locally on their development machine. This would not be quite the
case with VMs or raw artefacts (JARs, source code archives, ...). Moreover, the OCI ecosystem does
not only include specifications on how to interact with images, but also how to setup and configure
critical elements such as persistence and networking. These aspects are made very simple with
Docker, and would be quite a pain to manage securely with most other technologies.

Finally the main reason for us is the choice of runtime. We have very decent container runtimes
([RKE](https://www.rancher.com/products/secure-kubernetes-distribution),
[RHOS](https://developers.redhat.com/products/openshift/overview), [K3s](https://k3s.io/)) available
to deploy applications. We are very familiar with them, and they offer us a lot of functionality.
These all support containers primarily.

# A Tiny Bit of Background

Last before we get into the dirty details, a tiny bit of background into what we are building. The
application we will be building here is a sort of a facade reverse proxy. It offers a standardized
API to clients, which can connect and perform requests. Based on the content of the request, the
component will trigger a routing algorithm that defines where the request needs to be routed. This
routing algorithm might require several API calls in the backend to different systems to figure out
where the call should go. Once done, the component will relay the call to a backend, and forward the
response to the client. The client is never aware that it is talking to more than one component, and
only needs to authenticate to that single system. Imagine an API Gateway, but where the routing is
extremely complex and requires integration with systems such as Kubernetes, a cloud portal, and
more.

# The Details

Here is an overview of our `Dockerfile`:

```dockerfile,linenos
FROM internal.registry/base/ca-bundle:20220405 AS cert-bundle

FROM internal.registry/base/python:3.9.2-slim AS builder

COPY --from=cert-bundle /certs/ /usr/local/share/ca-certificates/
RUN update-ca-certificates

WORKDIR /app

RUN pip install \
  --upgrade \
  --no-cache-dir \
  --ignore-installed \
  --trusted-host pypi.python.org \
  --trusted-host pypi.org \
  --trusted-host files.pythonhosted.org \
  pipenv==2024.2.0

ENV PIPENV_VENV_IN_PROJECT=1
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

COPY Pipfile Pipfile
COPY Pipfile.lock Pipfile.lock

RUN pipenv install --deploy

### Tester image
FROM builder AS test

RUN pipenv install --dev --deploy

COPY ./pyproject.toml pyproject.toml
COPY ./assets/ ./assets
COPY ./features/ ./features
COPY ./tests/ ./tests
COPY ./src/ ./

RUN --mount=type=cache,target=./.mypy_cache/ \
  --mount=type=cache,target=./.pytest_cache/ \
  pipenv run mypy . \
  && pipenv run black --check . \
  && pipenv run bandit -ll ./*.py \
  && PYTHONPATH=./ pipenv run pytest


### Runner image
FROM internal.registry/base/distroless-python:3.9.2
LABEL maintainer="Redacted <redacted-email>"

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app/
USER 1000

COPY --from=builder --chown=1000 /app/.venv/lib/python3.9/site-packages ./my-app
WORKDIR /app/my-app

COPY --chown=1000 ./src/ ./

ENTRYPOINT ["python3"]
CMD ["./main.py"]
```

We will go through it line by line and figure out why we did what we did, and why we did not choose
a different approach. Let's start!

---

```dockerfile,linenos
FROM internal.registry/base/ca-bundle:20220405 AS cert-bundle
```

In this line we reference a container image for later use and provide it a name alias `cert-bundle`.
This container image contains only data: our production network proxy certificates and all internal
certificate authorities. We need these CAs as we will connect over TLS to backend components that
have internal certificates. We also need the production network proxy certificates as we will pull
dependencies straight from the internet, and all that traffic is routed over a gateway proxy. Why
distribute these certificates over a Docker image instead of a compressed TAR? The main reason is
that we want to have a unified way that we build artefacts and manage CI/CD pipelines. By creating
and managing the certificates via Docker, we can use our entire Docker setup (such as
UCD/Jenkins/Tekton pipelines for building, registry for distribution, quality gates for security,
etc) and do not need to have a different system to manage the certificates. Note that we refer to
the exact state of the certificate bundle (`20220405`), which refers to the state of the
certificates per 5th of April 2022. This is very important to make the build reproducible. If we did
not pin the version of the certificates, it would mean that we could build the image maybe today,
but it would fail tomorrow, once the certificates change (even though we did not change the code at
all). You will note that we will pin every single version in the entire build process.

---

```dockerfile,linenos
FROM internal.registry/base/python:3.9.2-slim AS builder
```

In this line, we reference the base image we will start building from. This is the official Python
image for Python version 3.9.2. We use the slim version because we don't need much more than the
standard Python installation. We pull this from our own registry, as all Docker images are scanned
beforehand to reduce the risk of supply chain attacks. Also here, the version is pinned. We provide
this build step the `builder` alias. In essence this means that starting from this line we define an
image stage that will contain the build process of our application. For Python, this mostly includes
downloading dependencies (both software and system level), and injecting the source code, as there
will be no compile step.

---

```dockerfile,linenos,hl_lines=3
FROM internal.registry/base/python:3.9.2-slim AS builder
# ...
COPY --from=cert-bundle /certs/ /usr/local/share/ca-certificates/
```

This copies our certificates into our build image. We do this by referencing the build step
`cert-bundle` (see first line of the `Dockerfile` again) in the `--from` argument of the `COPY`
command. Note that we could have referenced the image directly in the `--from` argument. We choose
to use build stage aliases for visibility, and reduce duplication if the certificates need to be
copied into different stages. Note that this copies only the raw certificates. A OS specific bundle
would still need to be generated.

---

```dockerfile,linenos,hl_lines=3
FROM internal.registry/base/python:3.9.2-slim AS builder
# ...
RUN update-ca-certificates
```

Here we do exactly this, we generate a certificate bundle for the underlying OS of our builder image
([Debian](https://www.debian.org/)). This allows our subsequent build steps to use the certificate
bundle to validate host certificates on TLS connections.

---

```dockerfile,linenos,hl_lines=3
FROM internal.registry/base/python:3.9.2-slim AS builder
# ...
WORKDIR /app
```

We then set a working directory. The idea is to have a base directory on which we now operate. This
can be nearly any working directory, and will be created if non-existent. We choose `/app/` by
convention. Moreover, note that we tend to reference directories with the trailing `/` to make it
more explicit that we are referencing directories and not files. We use this convention throughout
the configuration/code.

---

```dockerfile,linenos,hl_lines=3-10
FROM internal.registry/base/python:3.9.2-slim AS builder
# ...
RUN pip install \
  --upgrade \
  --no-cache-dir \
  --ignore-installed \
  --trusted-host pypi.python.org \
  --trusted-host pypi.org \
  --trusted-host files.pythonhosted.org \
  pipenv==2024.2.0
```

We use an environment virtualization technology for Python. This is called
[`pipenv`](https://pipenv.pypa.io/en/latest/index.html). It allows us to have many different
versions of the same dependency installed locally, without them conflicting. This is very important
when you are developing many applications at the same time locally. By running this line we install
version `2024.2.0` of `pipenv` (pinned). Other than Python itself, these are the only tools required
for our Python development environment. If we were using a different language, `pipenv` would be
substituted with your dependency management tool (such as Maven for Java). Note that we only install
`pipenv` itself, we do not install the dependencies. Also using the flags provided we ensure a fully
clean install of `pipenv`.

> This is an example where we reach out to the internet and thus needed the network proxy
> certificates.

A very good question here might be "why to use `pipenv` at all, considering it is typically used for
environment virtualization, which is already covered by Docker itself?". There are two aspects here.
The first is to allow us to lock dependencies using their hash, which is not natively supported by
`pip` (the standard Python package manager). The second is that we want to keep the build process
within Docker as close to the build process outside of it. While we do not build artefacts outside
of Docker per-se, the IDEs of our developers need to fall back on these technologies to support
features such as library-aware code completion, type-checking, test integration, debugging, etc.
This could also be achieved by connecting the IDE to an instance running directly in Docker. This
however is relatively complex and requires the setup to support remote debugging. In theory, these
are not really problems as long as the dev environments are uniform, but we allow each developer to
work with the tools he/she desires to develop code. It then suddenly becomes very difficult to have
a stable setup that works for everybody, especially considering that some of our developers do not
want/know how to configure their environments to that level (client-server debugger setups, network
and volume management between the IDE and Docker, ...).

---

```dockerfile,linenos,hl_lines=3-4
FROM internal.registry/base/python:3.9.2-slim AS builder
# ...
ENV PIPENV_VENV_IN_PROJECT=1
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
```

Here we set environment variables for `pipenv`. Firstly we want the dependencies to be installed
directly in the project repository, not centrally. This allows us to ensure that we do not
accidentally copy a system Python dependency that installed by default with the base image. The
second configures the certificate bundle we generated in the beginning to be used by `pipenv`. It
does not use the system configured bundle by default, so it needs to be configured manually here.

---

```dockerfile,linenos,hl_lines=3-4
FROM internal.registry/base/python:3.9.2-slim AS builder
# ...
COPY Pipfile Pipfile
COPY Pipfile.lock Pipfile.lock
```

Now the interesting stuff. Here we copy the dependency files into the image. The first file contains
a list of dependencies that we use for our project. The second contains a hash the dependencies
should have, including indirect dependencies (dependencies of dependencies), in order to ensure that
we always get exactly the same dependency code for very install. The first looks as follows:

```toml,linenos
[[source]]
url = "https://pypi.org/simple"
verify_ssl = true
name = "pypi"

[packages]
requests = "==2.28.2"
pydantic = "==1.10.4"
# more dependencies ...

[dev-packages]
black = "==23.1"
bandit = "==1.7.4"
pytest = "==7.2.1"
pytest-mock = "==3.9.0"
pytest-bdd = "==6.1.1"
mypy = "==1.1.1"
types-Pygments = "==2.14.0.6"
# more dev dependencies ...

[requires]
python_version = "3.9"
```

Note that we split dependencies into normal packages we require for our application, and packages
only required for testing and our quality gates (`[dev-packages]`). This is important later on, as
we do not wish to have packages only required for testing in our production Docker image.

I will not show you an example of the lock file, as it contains mostly checksum hashes. Simply trust
me that it contains the exact checksum that every package (such as the dependencies of `requests`)
has to have to be installed. The reason this is required in the first place, is because the
dependencies of `requests` are likely not pinned to an exact version and might thus change between
installations unless locked via our `Pipfile.lock`. This would undesired as it would make our builds
un-reproducible. The lock file itself is generated by our developers in two different scenarios. The
first is when a library is added due to some new feature. In such a case the new library is added to
the `Pipfile`, and an installation is triggered outside of Docker. This will install the new library
and potentially update already installed ones (in case of conflicts). Hence new hashes will be added
to the lock file. The second is on a lifecycle of the existing libraries or of our Python version.
In such a case we update the pinned version in the `Pipfile` and trigger an installation outside of
Docker. Again, `pipenv` would then update the direct dependencies, and potentially transitive ones,
and update their hashes in the lock file.

---

```dockerfile,linenos,hl_lines=3
FROM internal.registry/base/python:3.9.2-slim AS builder
# ...
RUN pipenv install --deploy
```

Here we install the dependencies for our application. The `--deploy` flag means that we want to
install the dependencies based on the lock file. Moreover, we do not install the dev packages yet,
only the ones needed for the production code.

---

```dockerfile,linenos
### Tester image
FROM builder AS test
```

Here we generate a new Docker build stage. We have generated a stage with `builder` that contains
the required certificates and the production dependencies, and nothing more. We now want to test our
code and validate quality gates. We do not want to perform this in the `builder` stage, because it
would pollute our production dependencies. Moreover, using a different stage allows to trigger
builds more granularly with [BuildKit](https://docs.docker.com/build/buildkit/). For instance, I
would be able to configure (with `--target=test`) to only build the image up to the `test` stage,
and skip any later stages (such as the runtime image in our case). This can be very useful in
pipelines, for instance, where we want to run the test on every commit, but are not interested in
building a real artefact unless the commit is tagged.

With this line we essentially say "start a new stage called `test` from the latest state of
`builder`". We also add a comment above to make it more visible that we are starting a new stage in
the `Dockerfile`. Stage comments are typically the only comments we have in the `Dockerfile`s.

---

```dockerfile,linenos,hl_lines=3
FROM builder AS test
# ...
RUN pipenv install --dev --deploy
```

In this line we now deploy the development dependencies, including tools for quality checks (`mypy`,
`bandit`, `black`, see below for details) and for testing. Again, we use the `--deploy` flag to
ensure we always use the same versions to make the build fully reproducible.

---

```dockerfile,linenos,hl_lines=3-7
FROM builder AS test
# ...
COPY ./pyproject.toml pyproject.toml
COPY ./assets/ ./assets
COPY ./features/ ./features
COPY ./tests/ ./tests
COPY ./src/ ./
```

Here is the first time we copy actual content, other than the list of dependencies, into our image.
This means that up until now all layers in the build process can be fully cached if we perform code
changes. Thinking about this is _primordial_ if you want an efficient build process. Even here, we
copy code in reverse order based on likelihood of change. The first file we copy in configures our
tooling and quality gates. This is unlikely to change unless we introduce a new tool or change
configuration of an existing one. An example of the file can be seen below.

The second line copies assets. These are used for testing, such as test configurations for
configuration validation etc. These are also quite unlikely to change unless we write new tests of
our configuration classes.

The third line copies in our [Cucumber](https://cucumber.io/docs/installation/python/) files for BDD
testing. These change only when we either define new behavioral tests or add features.

The fourth line copies our test code, this is quite likely to change, as it contains all our unit
tests, and the testing framework for behavioral tests.

Finally the last line copies in our actual code. This, along with the unit tests, is the code that
is most likely to change, and thus comes last. This way on a code change, all lines up to this one
(assuming we did not add/change tests) can be used from cache.

```toml,linenos
[tool.black]
line-length = 100

[tool.pytest.ini_options]
pythonpath = [
  "src",
  "tests",
]
bdd_features_base_dir = "features/"

[tool.mypy]
exclude = [
  '^tests/.*\.py$',
]
ignore_missing_imports = false
warn_unused_configs = true
warn_redundant_casts = true
# more settings ...

[[tool.mypy.overrides]]
module = [
  "kubernetes",
  "parse_types",
]
# skip libraries without stubs
ignore_missing_imports = true
```

---

```dockerfile,linenos,hl_lines=3-8
FROM builder AS test
# ...
RUN --mount=type=cache,target=./.mypy_cache/ \
  --mount=type=cache,target=./.pytest_cache/ \
  pipenv run mypy . \
  && pipenv run black --check . \
  && pipenv run bandit -ll ./*.py \
  && PYTHONPATH=./ pipenv run pytest
```

This line aggregates our quality gates and testing. For quality gates we have:

- [`mypy`](https://www.mypy-lang.org/): checks typing information where provided. We do not perform
  strict typing so that type information is required everywhere, but we validate that the provided
  typing is correct.
- [`black`](https://black.readthedocs.io/en/stable/): checks formatting of the code to ensure it is
  according to your guidelines.
- [`bandit`](https://bandit.readthedocs.io/en/latest/): performs basic security checks. This is a
  non-blocking check, meaning that the build will only fail if issues of severity `MEDIUM` or higher
  a found. `LOW` severity check fails are ignored.

Finally we run our testing (with [`pytest`](https://docs.pytest.org/en/7.2.x/)). We run the testing
last, as it is the most time consuming of the tasks, and it does not need to be executed if the code
fails to adhere to our standards. Note that you could add any other gates here, such as a code
coverage baseline that needs to be adhered to, various code analysis checks, or security scans. We
only perform one more security check against dubious code and supply chain attacks during the build
process. This check is however done on the final Docker image and is thus executed by the pipeline
itself outside of the Docker build process.

Note that all commands are executed as one `RUN` statement. This is best practice, as none of these
commands can be cached individually. Either all have to be executed again if layer it builds upon
changed, or none has to run. Putting them into the same `RUN` statement generates a single new layer
for all four commands, which reduces the layer count and build overhead for Docker.

Finally, note the `--mount` options passed to `RUN` (introduced with BuildKit 1.2). These allow to
cache content within the Docker build between builds. Here we mount two caches, one for `mypy` and
one for `pytest`. These ensure that if a subsequent Docker build is triggered for code that does not
affect some files, the typing checks and tests are not run again for these files, but taken from the
cache. For `pytest` this is actually done on a "per-test" basis, ensuring tests are not run unless
code they are testing is changed. Such caches can massively increase the speed of your pipelines,
especially when your project grows and the test suites start to take more time to run through.

---

```dockerfile,linenos
### Runner image
FROM internal.registry/base/distroless-python:3.9.2
```

This defines the runner image. We are done with testing and want to build the productive artefact,
as all checks have passed. In a compiled setup, this would mean we would now have a release
compilation stage (before building the runtime image). This is done after testing as the release
binary/JAR will be compiled with optimizations, which can take quite long, and is unnecessary if the
tests fail anyways. Thus in a compiled language like Java or Golang, we would now continue from the
builder again, copy the code back into the layer, and compile. Here one should be careful, most
languages support incremental compilation to reduce compilation times. When this is supported, one
needs to mount a build cache, or the incremental compilations from previous builds will be lost
every time the code changes, as the entire compilation layer will be discarded from the cache. This
is done the same way as in the previous block, with `--mount` parameters.

Once the compilation is completed, and we have our final artefact (binary or JAR), we want to copy
it into the runtime image. The idea is again to restrict bloat to reduce our attack surface. For
instance, in a Java setup, we only need a working JRE to run our application, we no longer need
Maven, the Java compiler, etc. Thus, after the build process, we use a new stage for the runtime
image. This is what we did for Python here, since we have no compilation step. We use a different
image than our initial `internal.registry/base/python:3.9.2-slim` image, as we no longer need `pip`
(the Python package manager), and other bloat. Instead we use a distroless image, which is
essentially a stripped down Debian image containing truly the base minimum to run Python code, but
nothing to manage it, etc. Again, we use our own copy of the distroless image from our scanned
registry.

---

```dockerfile,linenos,hl_lines=3
FROM internal.registry/base/distroless-python:3.9.2
# ...
LABEL maintainer="Redacted <redacted-email>"
```

This line adds metadata to the image. This is not necessary to have a good image, but useful when
using images that are shared across huge organisations. This is the official maintainer label we
use, where we reference our team, such that anyone that downloads the image and inspects it can see
who built it, and how to get into contact with us in case of issues.

---

```dockerfile,linenos,hl_lines=3-4
FROM internal.registry/base/distroless-python:3.9.2
# ...
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
```

Same as before, we copy certificates and configure Python to use our bundle. Note that this time we
directly copy the bundle generated in the builder and not from the certificate image, as we need a
bundle and cannot create it in this image (`update-ca-certificates` is not contained in the
distroless image). We need to copy this explicitly since we started from a fresh image. The `test`
stage had the bundle implicitly configured from the `builder` stage, upon which it was set up.

---

```dockerfile,linenos,hl_lines=3-4
FROM internal.registry/base/distroless-python:3.9.2
# ...
WORKDIR /app/
USER 1000
```

We set a working directory again. This is also necessary since starting from a fresh image. Also we
set a non root user. This is necessary since we do not want to run our code as root for security
reasons (reduce the impact of a remote code execution - RCE vulnerability). Note that any statement
after the `USER` statement will be executed in the context of that user. Therefore I would for
instance not be allowed to run `update-ca-certificates` (if it was present in the image) in a `RUN`
statement from now on, as this requires root privileges.

---

```dockerfile,linenos,hl_lines=3-4
FROM internal.registry/base/distroless-python:3.9.2
# ...
COPY --from=builder --chown=1000 /app/.venv/lib/python3.9/site-packages ./my-app
WORKDIR /app/my-app
```

Here we copy the non-dev packages from the `builder` stage into our productive image. Note that we
use a path from within the project root (`/app/`), since we set `pipenv` to install the virtual
environment directly in the project (the `PIPENV_VENV_IN_PROJECT` variable). We copy the
site-packages (the dependencies) directly into a subfolder, in which our application will live. This
ensures that they are treated as if we wrote them ourselves, as individual Python modules in our
code. They essentially become indistinguishable from our own code. This allows to keep consistency
in our module names are resolved. Note we need to add the `--chown` flag, as the dependencies were
installed by the root user in the `builder` image, and they need to be readable by our user 1000
that will run the application. The `--chown` flag will change the files' owner (and group) to the
provided argument.

The second line simply sets the new working directory to be the new project directory into which we
copied the code from the dependencies.

---

```dockerfile,linenos,hl_lines=3
FROM internal.registry/base/distroless-python:3.9.2
# ...
COPY --chown=1000 ./src/ ./
```

Here we copy the source code back into the production image. We did this after copying the
dependencies, such that the dependency layer can be cached again. Moreover, we only copy the source
code, no tests, no assets, no Cucumber features. All these latter ones are not needed to run our
application. Finally note that we copy it not from the `test` stage, but again back from the outside
build context. This is because we mock a lot during testing, changing some code behavior
dynamically. Copying it back in from the outside context ensures we do copy the exact code that is
in our Git repository, and not something that was accidentally modified during testing, etc.

---

```dockerfile,linenos,hl_lines=3-4
FROM internal.registry/base/distroless-python:3.9.2
# ...
ENTRYPOINT ["python3"]
CMD ["./main.py"]
```

Finally we set an entrypoint and a command. The entrypoint defines what will always be executed on a
Docker run (unless explicitly overwritten), and the command provides the default arguments unless
overwritten via the Docker run arguments. We always use lists instead of full strings to ensure that
the arguments get passed to the Kernel as system calls instead of being executed by a shell. This is
important to ensure proper signal handling (when you want to terminate containers), and since there
is simply no shell in the distroless image we are building.

# That's it

Holy molly... There is a lot that goes into building a simple Docker image. And that considering we
did not even compile anything, which would require a decent amount of extra work, and that all our
tooling can be managed directly via `pipenv` and do not need to be installed separately via `curl`
or some OS package manager.

So is it worth it? To put so much thought into how a simple Docker image gets built? I would argue
yes. I will not start an idiomatic discussion on the benefits of smaller images, security best
practices, or having tests being run directly in the Docker build. If you want such a discussion, go
to Reddit or Youtube, you find plenty of beef between people fighting about these topics like their
life depends on it. All I will say is this:

- I can run docker build ... after each save on a file, since the caching is optimized to a point
  where a full build on a code changes takes about 1-2 seconds. Being able to run this so often gives
  me the confidence that what I will push will actually pass in the pipeline.
- Using proper caching makes me avoid having to wait 2-5 minutes each time I want to compile
  something. Since 2-5 minutes is typically too little for a context switch to something else, it
  might be time I would have just sat around thinking about how much it sucks to wait on stuff. So it
  has considerably improved not only my productivity, but also my mood.
- Docker avoids some "it works on my machine" issues. With proper version pinning and fully
  reproducible builds, it really nearly eradicates the issue. Now the only time something like this
  can happen is when running on different Docker versions.
- We all sometimes would like to fix tests by skipping them to "save time" when something needs to
  go to production quickly. Since testing is fully baked into the build process, changing flags on
  Jenkins/Tekton/whatever will not allow you to skip any testing or quality checks on the code. The
  only way would be to comment out the test code or update the Dockerfile, which would not pass a PR
  review. This gives me immense peace of mind.

Since the build process and testing is (nearly) fully defined in the `Dockerfile` which lies in the
git repository, we nearly never need to change pipelines to add/change/remove anything, as all of
this can be done in the repository of the corresponding image directly. This also has downsides, as
it creates duplication. I would argue that this is beneficial though, as legacy applications might
not be able to switch to newer tooling as fast as greenfield projects, which want to leverage that
new tooling. Having this "configured" in each repository allows each to move at its own pace. Strict
guidelines (such as we don't want to use tool X anymore) can still be enforced on pipeline level via
container scanning tools (which you will need either way).

What's the major downside of this approach? Well I would argue there is one large one. Many people
might not understand Docker well enough to figure out how the build process works, or might not have
time to invest to learn how to do it correctly. This means that some people might not be able to
make changes to the build processes by themselves and need might help. I think this would also be
the case without a proper Docker setup, but maybe this problem is augmented by having a slightly
more complex Docker build setup.

I hope this has given you some food for thought. Feel free to comment any questions or remarks
below, or to reach out! Do you also take your Docker builds this far?
