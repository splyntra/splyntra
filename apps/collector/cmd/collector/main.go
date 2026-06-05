// SPDX-License-Identifier: AGPL-3.0-only
// Command collector is the open-source Splyntra event collector binary.
//
// It registers no extension modules, so the commercial surface (governance,
// etc.) is absent from this build — those endpoints return 404. The commercial
// build lives in a separate repository: it blank-imports its modules (which
// self-register via init) and then calls app.Run.
package main

import "github.com/splyntra/splyntra/apps/collector/app"

func main() { app.Run() }
