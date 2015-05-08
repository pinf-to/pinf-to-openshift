*Status: DEV*

Publish PINF Logic to OpenShift
==================================

Use this tool to publish [PINF Logic](https://github.com/pinf-logic/pinf.logic) to [OpenShift](http://openshift.com).


Usage
-----

    "github.com/pinf-to/pinf-to-openshift/0": {
        "$to": "live",
        "sourcePath": "{{$from.pgs.programs.server.getRuntimeConfigFor(server).sourcePath}}",
        "openshift": {
            "app": "pinfwiki",
            "cartridge": "php-5.4"
        }
    }

    "github.com/pinf-to/pinf-to-openshift/0": {
        "$to": "live",
        "sourcePath": "{{$from.pgs.programs.client.getRuntimeConfigFor(server).targetPath}}",
        "openshift": {
            "app": "pinfme",
            "cartridge": "nodejs-0.10",
            "aliases": {
                "pinf.me": true
            }
        }
    }


Provenance
==========

Original source logic [UNLICENSED](http://unlicense.org/) by [Christoph Dorn](http://christophdorn.com).
