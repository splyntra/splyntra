{{/* Expand the name of the chart. */}}
{{- define "splyntra.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified app name. */}}
{{- define "splyntra.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "splyntra.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "splyntra.labels" -}}
app.kubernetes.io/name: {{ include "splyntra.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "splyntra.secretName" -}}
{{ include "splyntra.fullname" . }}-secrets
{{- end -}}

{{/* Component fullname, e.g. <release>-splyntra-collector */}}
{{- define "splyntra.component" -}}
{{ include "splyntra.fullname" . }}-{{ . }}
{{- end -}}

{{/* In-cluster service host helpers */}}
{{- define "splyntra.postgresHost" -}}{{ include "splyntra.fullname" . }}-postgres{{- end -}}
{{- define "splyntra.clickhouseHost" -}}{{ include "splyntra.fullname" . }}-clickhouse{{- end -}}
{{- define "splyntra.natsHost" -}}{{ include "splyntra.fullname" . }}-nats{{- end -}}
{{- define "splyntra.valkeyHost" -}}{{ include "splyntra.fullname" . }}-valkey{{- end -}}

{{/* Resolved DSNs — external override wins, else point at the bundled backend. */}}
{{- define "splyntra.postgresDsn" -}}
{{- if .Values.external.postgresDsn -}}
{{ .Values.external.postgresDsn }}
{{- else -}}
{{ printf "postgres://%s:%s@%s:5432/%s?sslmode=disable" .Values.secrets.postgresUser .Values.secrets.postgresPassword (include "splyntra.postgresHost" .) .Values.secrets.postgresDb }}
{{- end -}}
{{- end -}}

{{- define "splyntra.clickhouseDsn" -}}
{{- if .Values.external.clickhouseDsn -}}
{{ .Values.external.clickhouseDsn }}
{{- else -}}
{{ printf "clickhouse://%s:%s@%s:9000/%s" .Values.secrets.clickhouseUser .Values.secrets.clickhousePassword (include "splyntra.clickhouseHost" .) .Values.secrets.clickhouseDb }}
{{- end -}}
{{- end -}}

{{- define "splyntra.natsUrl" -}}
{{- if .Values.external.natsUrl -}}
{{ .Values.external.natsUrl }}
{{- else -}}
{{ printf "nats://%s:4222" (include "splyntra.natsHost" .) }}
{{- end -}}
{{- end -}}

{{- define "splyntra.valkeyAddr" -}}
{{- if .Values.external.valkeyAddr -}}
{{ .Values.external.valkeyAddr }}
{{- else -}}
{{ printf "%s:6379" (include "splyntra.valkeyHost" .) }}
{{- end -}}
{{- end -}}

{{- define "splyntra.collectorImage" -}}
{{ .Values.images.collector.repository }}:{{ .Values.images.collector.tag | default .Chart.AppVersion }}
{{- end -}}
{{- define "splyntra.securityImage" -}}
{{ .Values.images.security.repository }}:{{ .Values.images.security.tag | default .Chart.AppVersion }}
{{- end -}}
{{- define "splyntra.webImage" -}}
{{ .Values.images.web.repository }}:{{ .Values.images.web.tag | default .Chart.AppVersion }}
{{- end -}}
{{- define "splyntra.evaluationImage" -}}
{{ .Values.images.evaluation.repository }}:{{ .Values.images.evaluation.tag | default .Chart.AppVersion }}
{{- end -}}
{{- define "splyntra.minioHost" -}}{{ include "splyntra.fullname" . }}-minio{{- end -}}
