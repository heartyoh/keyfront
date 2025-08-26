{{/*
Expand the name of the chart.
*/}}
{{- define "keyfront-bff.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "keyfront-bff.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "keyfront-bff.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "keyfront-bff.labels" -}}
helm.sh/chart: {{ include "keyfront-bff.chart" . }}
{{ include "keyfront-bff.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: {{ include "keyfront-bff.name" . }}
app.kubernetes.io/component: backend-for-frontend
{{- end }}

{{/*
Selector labels
*/}}
{{- define "keyfront-bff.selectorLabels" -}}
app.kubernetes.io/name: {{ include "keyfront-bff.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "keyfront-bff.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "keyfront-bff.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.existingServiceAccount }}
{{- end }}
{{- end }}

{{/*
Create the name of the secret to use
*/}}
{{- define "keyfront-bff.secretName" -}}
{{- if .Values.secrets.create }}
{{- default (printf "%s-secrets" (include "keyfront-bff.fullname" .)) .Values.secrets.existingSecret }}
{{- else }}
{{- .Values.secrets.existingSecret }}
{{- end }}
{{- end }}

{{/*
Create the name of the configmap to use
*/}}
{{- define "keyfront-bff.configMapName" -}}
{{- if .Values.configMaps.create }}
{{- default (printf "%s-config" (include "keyfront-bff.fullname" .)) .Values.configMaps.existingConfigMap }}
{{- else }}
{{- .Values.configMaps.existingConfigMap }}
{{- end }}
{{- end }}

{{/*
Create image reference
*/}}
{{- define "keyfront-bff.image" -}}
{{- if .Values.global.imageRegistry }}
{{- printf "%s/%s:%s" .Values.global.imageRegistry .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- else }}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}
{{- end }}

{{/*
Create Redis URL from components
*/}}
{{- define "keyfront-bff.redisUrl" -}}
{{- if .Values.redis.url }}
{{- .Values.redis.url }}
{{- else if .Values.redis.password }}
{{- printf "redis://:%s@%s:%d/%d" .Values.redis.password .Values.redis.host (.Values.redis.port | int) (.Values.redis.database | int) }}
{{- else }}
{{- printf "redis://%s:%d/%d" .Values.redis.host (.Values.redis.port | int) (.Values.redis.database | int) }}
{{- end }}
{{- end }}

{{/*
Validate required values
*/}}
{{- define "keyfront-bff.validateValues" -}}
{{- if not .Values.keycloak.issuerUrl }}
{{- fail "keycloak.issuerUrl is required" }}
{{- end }}
{{- if not .Values.keycloak.clientId }}
{{- fail "keycloak.clientId is required" }}
{{- end }}
{{- if not .Values.keycloak.clientSecret }}
{{- fail "keycloak.clientSecret is required" }}
{{- end }}
{{- if not .Values.keycloak.redirectUri }}
{{- fail "keycloak.redirectUri is required" }}
{{- end }}
{{- if not .Values.config.sessionSecret }}
{{- fail "config.sessionSecret is required" }}
{{- end }}
{{- end }}

{{/*
Create security context for restricted pod security standard
*/}}
{{- define "keyfront-bff.restrictedSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop:
  - ALL
readOnlyRootFilesystem: false
runAsNonRoot: true
runAsUser: 1001
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{/*
Create pod security context for restricted pod security standard
*/}}
{{- define "keyfront-bff.restrictedPodSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1001
runAsGroup: 1001
fsGroup: 1001
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{/*
Generate certificates for webhook
*/}}
{{- define "keyfront-bff.gen-certs" -}}
{{- $altNames := list ( printf "%s.%s" (include "keyfront-bff.name" .) .Release.Namespace ) ( printf "%s.%s.svc" (include "keyfront-bff.name" .) .Release.Namespace ) -}}
{{- $ca := genCA "keyfront-bff-ca" 365 -}}
{{- $cert := genSignedCert ( include "keyfront-bff.name" . ) nil $altNames 365 $ca -}}
tls.crt: {{ $cert.Cert | b64enc }}
tls.key: {{ $cert.Key | b64enc }}
{{- end }}