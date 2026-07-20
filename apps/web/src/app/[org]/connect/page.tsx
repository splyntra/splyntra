// SPDX-License-Identifier: FSL-1.1-ALv2
import { redirect } from "next/navigation";

// Connect is now the agent-creation wizard under Agents. Webhook platforms live
// in Agent Platforms, MCP servers in MCP Servers.
export default function ConnectRedirect({ params }: { params: { org: string } }) {
  redirect(`/${params.org}/agents/new`);
}
