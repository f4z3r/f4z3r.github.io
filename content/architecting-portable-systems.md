+++
title = "Architecting Portable Systems on Open Standards for Digital Sovereignty"
date = 2026-03-23

[taxonomies]
tags = ["kubernetes", "sovereignty", "open-source"]

+++

{{ banner(src="/img/architecting-portable-systems/banner.png",
          alt="A hand holding a ship.",
          size="width:100%;height:300px;",
          style="margin:-8% 0") }}

> This article was originally posted on
> [InfoQ](https://www.infoq.com/articles/portable-systems-sovereignty/).

Digital sovereignty isn't about building everything yourself; it's about having a valid "Plan B".
What would your "Plan B" be if your vendor for a critical system suddenly decided to
[quadruple its price tag](https://www.ciodive.com/news/broadcom-vmware-acquistion-vcf-private-cloud/733800/)
or if it decided to abandon product development and suddenly communicated a
[product "end-of-life" deadline](https://techcrunch.com/2022/08/17/google-cloud-will-shutter-its-iot-core-service-next-year/)?
How would you feel if your government were utterly reliant on another geopolitical entity in order
to sustain basic (digital) operations? What if your access to a SaaS provider were suddenly revoked
due to international sanctions?

In this article I will dive into three aspects of digital sovereignty and illustrate how
architectural choices and constraints can help address the scenarios described above. I will share
some insights into the benefits and risks of building "sovereign systems", and illustrate high-level
examples why this architectural choice might be more challenging than most people expect. As a
software architect working for various large enterprises, I share insights into open standards as
one of the main pillars to achieve sovereignty. It should, however, be noted that sovereignty is a
much larger topic overall.

<!-- more -->

# Digital Sovereignty

Digital sovereignty is a hot topic at the moment. This topic applies to both governments, such as
the EU, which has released sovereignty guidelines like the
[Cloud Sovereignty Framework](https://commission.europa.eu/document/download/09579818-64a6-4dd5-9577-446ab6219113_en),
and to private companies, who are overly reliant on vendors with abusive pricing power.

In the world of software enterprises, digital sovereignty can typically be broken down into four
axes: data sovereignty, technological sovereignty, operational sovereignty, and general IT
governance/strategy. For the technological and operational sides, sovereignty tends to be defined as
the ability to utilize, develop, and operate digital solutions independently. In other words, it is
a question of control over these solutions. The governance aspect defines how controls can be put in
place to ensure sovereignty practices are pursued. In this article, I will focus on technology,
operations, and governance, because data sovereignty often heavily touches on legal matters.

First and foremost, absolute digital sovereignty is an illusion. In our global economy, no country
can claim that it could continue to develop and operate software with full independence. While
countries at the forefront of the software revolution, such as the United States, have a massive
advantage, they too are dependent on others to provide raw materials and to produce some of the
hardware components required to keep their complex software systems operational. This illusion of
independence is even more true for individual businesses.

Because absolute sovereignty is not achievable, organizations should deliberately consider which of
their systems are truly critical for their business, and focus sovereignty efforts on these systems
or processes. Moreover, sovereignty does not imply that the companies should then do everything
themselves in order to be sovereign. This misconception leads businesses to think they need to
operate their own data centers and build every piece of software themselves. While this exercise
would not only be impossible in practice, it would result in extreme operational costs with
dependencies shifted down into the technology stack. After all, does your company also build their
own hardware and produce their own electricity to operate their data centers? Sovereignty is about
avoiding strong dependencies on individual vendors or geopolitical entities. It is therefore not an
issue if an organization relies on services from a vendor, as long as a shift to another vendor
providing equivalent services is possible within an acceptable cost range.

{{ figure(src="/img/architecting-portable-systems/dependency-stack.webp",
          caption="The dependency stack always has a deeper, hidden layer",
          caption_style="font-weight: bold; font-style: italic;",
          style="border-radius: 8px;") }}

But is this sovereignty truly needed? How likely is a scenario where such a dependency actually
creates an issue? Let us look at a real world example. My work revolves around building container
platforms that run services for a relatively large governmental organization. This entity
essentially acts as a cloud provider for various other governmental entities. While geopolitical
sovereignty is certainly relevant in such a context, let us instead focus on vendor independence,
which is more subtle. Governmental organizations need to publish larger contracts via a standardized
process to prevent corruption-prone contracting (i.e.,
[publishing via World Trade Organization](https://www.trade.gov/trade-guide-wto-gpa)). These
contracts are bound to a certain time frame, and need to be renewed periodically. At each renewal,
there is a good chance that the vendor winning the contract will change. So being overly reliant on
a vendor or product can prove fatal, because that vendor might not win a follow-up contract. While
this example focuses on a governmental entity, the private sector behaves similarly. Procurement
departments typically force vendor rotations, whether due to legislative restrictions or overall IT
strategic changes.

In addition, the last couple of years have shown that companies with strong customer lock-in might
aggressively change their pricing strategies. This change, in turn, leads many businesses to hastily
try to migrate away from these vendors to avoid high costs in the long run. Such financial risks are
also a part of the lack of sovereignty of your organization.

In conclusion, sovereignty is a complex topic that touches on geopolitical, legislative, and
financial aspects. While being fully independent is not possible, the above examples illustrate the
need to carefully consider when a strong reliance on vendors is an acceptable risk.

# Open Standards

Assuming that you identify a set of essential systems for a critical business process of your
organization, it makes sense to spend some time and money on the consideration of portability of
these systems to attain a higher level of independence, and thus sovereignty. While having
battle-proven migration strategies is an essential part of efficiently porting systems, the
architecture of the system itself very much defines how complex and time-intensive such a migration
strategy looks like. Building processes and software systems on open standards is a robust way to
ensure that building migration paths remains relatively low effort.

An open standard is a formalized set of requirements, specifications, constraints, or guidelines for
a system that is open for anyone to use without a fee. Such standards have typically attained a
certain level of maturity and are implemented by various vendors, making their products partially
interchangeable. Examples of open standards include:

- TCP, IP, and most of the standard network protocols to which we are accustomed.
- TLS, ACME, and other security protocols.
- SVG, PDF, and other document formats. Not all document formats are open standards. PDF for
  instance was proprietary for a long time before being released as an open standard by Adobe.
- USB and PCI as examples on how hardware devices can communicate with one another.

Most of these standards are protocols or formats. However, in some cases, large open source projects
become a de facto open standard. As vendors start building on top of these projects and adoption
soars, the underlying technology is identical across vendors. If spread is broad enough, the piece
of technology becomes a de facto standard that is respected across these vendors. For instance:

- PostgreSQL as a database engine (AWS Aurora, GCP Alloy DB, Azure DB for PSQL, but even other OSS
  software such as CockroachDB)
- Kubernetes as a container orchestration engine and extensible API (AWS EKS, GCP GKE, Azure AKS,
  OpenShift, and hundreds of other vendors)
- Kafka as an event streaming platform (AWS MSK, GCP Managed Service for Kafka, Azure Event Hub,
  Strimzi, Confluent, ...)
- Prometheus
- OpenTelemetry
- OpenSearch
- Apache Spark

The establishment of open standards can be seen in the open source community. In recent years, many
such standards were enterprise-maintained, and tried to revoke control from their users through
license changes. The most prominent cases were
[HashiCorp changing licenses](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license)
for Terraform and Vault, and the
[changes to Redis](https://www.infoq.com/news/2024/03/redis-license-open-source/). These examples
put the de facto standards at risk and the community immediately responded with the birth of
OpenTofu, OpenBao, and Valkey to ensure the continuation of these open standards.

These examples of licensing wars between vendors and the open source community are a great example
of the power of open standards. When adopting a proprietary product that is not standard-based, your
vendor is in a position of power, because you are but one of its customers. On the other hand, your
vendor is the only one providing its proprietary product, making your demand for it very inelastic.
When building on open standards, you no longer stand alone against the vendor. The open ecosystem
protects you against a vendor trying to change the rules of the game. Such vendors then have to
worry that their customers would be able to quickly move to a different product based on the same
standard. Your demand for a specific product has suddenly become elastic.

Considering the relative abundance of open standards, it might seem that designing portable
solutions is simple enough. However, it turns out to be more complex in practice than most expect.
The complexity mostly stems from overlooked dependencies to other systems or vendor specific
functionality.

# Exmaple: Kubernetes

My first example, in the context of container platforms, looks very simple on the surface. You build
everything on Kubernetes, which might currently be the most prominent example of a de facto open
standard. There are many providers of Kubernetes distributions. The product has a very strong
interface upon which one can develop systems. Thus one would think that building on top of it
enables extremely easy migrations to a different provider. This thinking is especially true because
other systems in the cloud native space tend to provide an interface layer on top of the Kubernetes
API in the form of custom resources and a controller. Thus, even supporting systems complementing
Kubernetes can be relatively nicely abstracted via its open standard.

However, looking under the hood this abstraction quickly becomes much more complex. Do the teams
designing software on Kubernetes truly only use native Kubernetes features, or do they also rely on
features specific to the Kubernetes distribution currently in use? This reliance can be as simple as
the storage provider. Is the storage provider you use on Kubernetes shipped with your specific
Kubernetes distribution? If it is, you will have a full data lock-in, unless you plan to perform a
storage migration to move your volumes to a different provider, which is quite a challenging task.
Consider the registry on which you distribute your OCI images and the CI/CD pipelines on which you
build your software. How will you deal with external systems on which you might accidentally rely?

In terms of operations, you also need to consider your independence. Are there any critical
knowledge silos fully contained within a single contractor? What about individuals, even internal
employees that are essential to the operation of our systems due to their vast
[tribal knowledge](https://en.wikipedia.org/wiki/Tribal_knowledge)? Moreover, your level of maturity
with respect to automation might play a role in your migration decisions. If you perform all your
resource management manually instead of using approaches such as GitOps, migrating to a different
provider might be operationally risky and time consuming.

As you can see, in practice, building fully on open standards is quite complex. This complexity is
mostly due to the gravity of convenience. Developers tend to choose the easiest path unless an
enterprise architecture establishes guardrails.

# Surviving Vendor Collapse or Pivot

Building on open standards can even help you when you fail to switch vendors. In some cases you
might build on top of an open standard whose provider no longer remains a viable option and where no
alternative provider yet exists. The licensing changes to HashiCorp Vault illustrate this scenario.
In such a case, since you built on an open standard, you have the option to maintain a fork of the
project yourself, and self-host the solution. Of course this solution needs to be considered with
great care, because it tends to involve a large investment and requires specialized organizational
knowledge.

However, in many such situations, an alternative provider might emerge in the market. In many cases
the provider might be the community itself, such as with OpenBao, or even a company that sees an
opportunity. Either way, with such an opportunity, your organization does not have to maintain a
fork and can rely on external engineering knowhow.

# The Hard Truths

I hope the above paragraphs clearly state my opinion for considering portability through open
standards for critical software systems. While designing for portability is not easy, it is one of
the most effective ways to reduce dependence on external entities. However, this choice comes at a
cost, and not only a financial one.

Designing portable systems reduces the hurdle to performing migrations. This approach unfortunately
also results in an increased migration cadence. While each migration is then simpler and less
costly, one needs to keep an eye out to ensure the overall migration burden, in its entirety, does
not increase unconstrained.

In addition, if a sovereignty risk is access denial to a system that is vendor controlled, one not
only needs to ensure that a migration is possible, but also ensure that migration is possible
without access to the vendor system. In other words, restoring to a different system should be
possible. This caveat is technically complex. In such cases, the organization also needs to consider
what an acceptable data loss is.

In the end, enterprise architects are responsible for designing guardrails so that applications and
sub-systems are portable. These architects must ensure that application architects and developers
build their systems for simple migrations and that operations are streamlined enough in case of a
pivot. Additionally, their guardrails must not cause developers too much friction, which can turn
into a breeding ground for shadow IT through workarounds built to escape the guardrails.

Assuming that you have strong enterprise architects and that a subset of your systems require some
level of sovereignty, I strongly encourage you to define an approach for maintaining portable
systems. Having a clear strategy for achieving system portability is the best reason to stay more
independent of vendors. While complex, such a structured architectural strategy is what separates a
passive technology consumer from a truly sovereign digital enterprise.
