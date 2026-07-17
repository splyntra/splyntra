// SPDX-License-Identifier: FSL-1.1-ALv2
package tenant

// Resolver maps authenticated keys to tenant context.
type Resolver struct {
	dsn string
}

func NewResolver(dsn string) *Resolver {
	return &Resolver{dsn: dsn}
}

// Enrich adds tenant metadata to span attributes.
func (r *Resolver) Enrich(orgID, projectID, env string) map[string]string {
	return map[string]string{
		"splyntra.org_id":     orgID,
		"splyntra.project_id": projectID,
		"splyntra.env":        env,
	}
}
