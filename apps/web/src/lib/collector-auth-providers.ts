// SPDX-License-Identifier: FSL-1.1-ALv2
// Extension point: the open edition registers no BFF auth resolver (single
// implicit org → the server key is correct). The commercial cloud build
// replaces this file in its composition step to register a resolver that scopes
// each collector request to the logged-in user's active org via a trusted
// service token + X-Splyntra-Org-Id headers. No-op here keeps the open build
// standalone.
export {};
