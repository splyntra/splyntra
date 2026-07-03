// SPDX-License-Identifier: Apache-2.0
import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

export class SplyntraApi implements ICredentialType {
  name = "splyntraApi";
  displayName = "Splyntra API";
  documentationUrl = "https://github.com/splyntra/splyntra/blob/main/docs/INTEGRATIONS.md";

  properties: INodeProperties[] = [
    {
      displayName: "Collector Base URL",
      name: "baseUrl",
      type: "string",
      default: "http://localhost:4318",
      placeholder: "https://ingest.splyntra.example.com",
      description: "Your Splyntra collector's OTLP/ingest base URL (no trailing slash).",
    },
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      description: "An ingest-scoped API key (Dashboard → API Keys, or Connect → No-code).",
    },
  ];

  // Sent on every request made with this credential.
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };

  // "Test" button in the credential UI — hits an authenticated read endpoint.
  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.baseUrl}}",
      url: "/v1/projects",
      method: "GET",
    },
  };
}
