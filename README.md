# My Blog

This repository is the base for https://f4z3r.github.io.

## Develop

You can run the website locally by running:

```sh
# pull the theme it is based on
git submodule update --init --recursive
# serve locally on localhost:1111
nix develop -c serve
# format the markdown files
nix develop -c format
```
