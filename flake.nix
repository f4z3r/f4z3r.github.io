{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem
    (
      system: let
        pkgs = import nixpkgs {inherit system;};
        serve = pkgs.writeShellScriptBin "serve" ''
          zola serve
        '';
        format = pkgs.writeShellScriptBin "format" ''
          prettier -w --ignore-unknown ./content/
        '';
      in
        with pkgs; {
          devShell = mkShell {
            packages = [
              fish
              zola
              prettier
              serve
              format
            ];
          };
        }
    );
}
