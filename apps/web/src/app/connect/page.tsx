// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

// Connect is now the agent-creation wizard under Agents. Webhook platforms live
// in Agent Platforms, MCP servers in MCP Servers.
export default function ConnectRedirect() {
  redirect("/agents/new");
}
