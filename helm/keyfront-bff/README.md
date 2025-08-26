# Keyfront BFF Helm Chart

## Overview

Keyfront BFF is an enterprise-grade Backend-for-Frontend gateway that provides secure authentication, authorization, and API gateway capabilities with Keycloak integration.

## Features

- 🔐 **Enterprise Security**: OIDC Authentication with PKCE flow
- 🏢 **Multi-tenant Architecture**: Isolated tenant management
- ⚡ **High Performance**: Optimized for production workloads
- 📊 **Observability**: Built-in monitoring and metrics
- 🔄 **Auto-scaling**: Horizontal Pod Autoscaler support
- 🛡️ **Security Hardened**: Pod Security Standards compliant

## Prerequisites

- Kubernetes 1.21+
- Helm 3.8+
- Keycloak instance (configured OIDC client)
- Redis instance (for session storage)

## Installation

### Quick Start

```bash
# Add the Helm repository (if published)
helm repo add keyfront https://charts.keyfront.io
helm repo update

# Install with minimal configuration
helm install my-keyfront-bff keyfront/keyfront-bff \
  --set keycloak.issuerUrl="https://keycloak.example.com/realms/master" \
  --set keycloak.clientId="keyfront-client" \
  --set keycloak.clientSecret="your-client-secret" \
  --set keycloak.redirectUri="https://bff.example.com/api/auth/callback" \
  --set redis.url="redis://redis-service:6379" \
  --set config.sessionSecret="your-32-char-session-secret"
```

### Custom Installation

```bash
# Create a values file
cat > my-values.yaml << EOF
# Custom configuration
replicaCount: 3

keycloak:
  issuerUrl: "https://keycloak.example.com/realms/production"
  clientId: "keyfront-production"
  clientSecret: "super-secret-client-secret"
  redirectUri: "https://bff.production.com/api/auth/callback"
  logoutRedirectUri: "https://app.production.com/"

redis:
  url: "redis://redis-cluster:6379"

config:
  sessionSecret: "your-super-secret-32-character-key"
  corsOrigins: "https://app.production.com,https://admin.production.com"
  rateLimitRpm: 1000

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: bff.production.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: bff-tls
      hosts:
        - bff.production.com

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  targetCPUUtilizationPercentage: 70

monitoring:
  serviceMonitor:
    enabled: true

resources:
  limits:
    cpu: 2000m
    memory: 1Gi
  requests:
    cpu: 500m
    memory: 512Mi
EOF

# Install with custom values
helm install my-keyfront-bff ./helm/keyfront-bff -f my-values.yaml
```

## Configuration

### Required Values

| Parameter | Description | Type | Required |
|-----------|-------------|------|----------|
| `keycloak.issuerUrl` | Keycloak OIDC issuer URL | string | ✅ |
| `keycloak.clientId` | Keycloak client ID | string | ✅ |
| `keycloak.clientSecret` | Keycloak client secret | string | ✅ |
| `keycloak.redirectUri` | OAuth callback URL | string | ✅ |
| `config.sessionSecret` | Session encryption key (32+ chars) | string | ✅ |

### Common Configuration Options

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `2` |
| `image.tag` | Image tag | `0.1.0` |
| `service.type` | Service type | `ClusterIP` |
| `ingress.enabled` | Enable ingress | `false` |
| `autoscaling.enabled` | Enable HPA | `false` |
| `monitoring.serviceMonitor.enabled` | Enable Prometheus monitoring | `false` |

### Security Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `podSecurityContext.runAsUser` | Pod user ID | `1001` |
| `securityContext.allowPrivilegeEscalation` | Allow privilege escalation | `false` |
| `networkPolicy.enabled` | Enable network policies | `false` |

## Examples

### Development Environment

```yaml
# dev-values.yaml
replicaCount: 1

keycloak:
  issuerUrl: "http://keycloak:8080/realms/dev"
  clientId: "keyfront-dev"
  clientSecret: "dev-secret"
  redirectUri: "http://localhost:3000/api/auth/callback"

redis:
  url: "redis://redis:6379"

config:
  sessionSecret: "dev-session-secret-32-characters"
  corsOrigins: "*"

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi
```

### Production Environment

```yaml
# prod-values.yaml
replicaCount: 5

strategy:
  rollingUpdate:
    maxUnavailable: 1
    maxSurge: 2

keycloak:
  issuerUrl: "https://auth.company.com/realms/production"
  clientId: "keyfront-prod"
  clientSecret: "ultra-secure-production-secret"
  redirectUri: "https://bff.company.com/api/auth/callback"
  logoutRedirectUri: "https://app.company.com/"

redis:
  url: "rediss://redis-cluster.company.com:6380"

config:
  sessionSecret: "production-grade-32-char-secret"
  corsOrigins: "https://app.company.com,https://admin.company.com"
  rateLimitRpm: 2000

ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/rate-limit: "100"
  hosts:
    - host: bff.company.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: bff-company-tls
      hosts:
        - bff.company.com

autoscaling:
  enabled: true
  minReplicas: 5
  maxReplicas: 50
  targetCPUUtilizationPercentage: 60
  targetMemoryUtilizationPercentage: 70

podDisruptionBudget:
  enabled: true
  minAvailable: 3

monitoring:
  serviceMonitor:
    enabled: true
    interval: 15s

networkPolicy:
  enabled: true
  egress:
    - to: []
      ports:
        - protocol: TCP
          port: 6379  # Redis
        - protocol: TCP
          port: 443   # HTTPS
        - protocol: TCP
          port: 8080  # Keycloak

resources:
  requests:
    cpu: 1000m
    memory: 1Gi
  limits:
    cpu: 2000m
    memory: 2Gi

affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchExpressions:
          - key: app.kubernetes.io/name
            operator: In
            values:
            - keyfront-bff
        topologyKey: kubernetes.io/hostname
```

## Operations

### Upgrade

```bash
# Upgrade with new values
helm upgrade my-keyfront-bff ./helm/keyfront-bff -f my-values.yaml

# Check rollout status
kubectl rollout status deployment/my-keyfront-bff
```

### Rollback

```bash
# List releases
helm history my-keyfront-bff

# Rollback to previous version
helm rollback my-keyfront-bff 1
```

### Monitoring

```bash
# Check pods
kubectl get pods -l app.kubernetes.io/name=keyfront-bff

# Check logs
kubectl logs -l app.kubernetes.io/name=keyfront-bff --tail=100

# Port forward for local testing
kubectl port-forward service/my-keyfront-bff 3000:3000
```

### Health Checks

The application provides several health check endpoints:

- `/api/health/live` - Liveness probe
- `/api/health/ready` - Readiness probe  
- `/api/health/detailed` - Detailed health information
- `/api/metrics` - Prometheus metrics

### Troubleshooting

#### Common Issues

1. **Pod not starting**
   ```bash
   kubectl describe pod <pod-name>
   kubectl logs <pod-name> --previous
   ```

2. **Configuration issues**
   ```bash
   kubectl get configmap my-keyfront-bff-config -o yaml
   kubectl get secret my-keyfront-bff-secrets -o yaml
   ```

3. **Network connectivity**
   ```bash
   kubectl exec -it <pod-name> -- nslookup redis-service
   kubectl exec -it <pod-name> -- curl -v http://keycloak:8080/realms/master
   ```

## Security Considerations

- Always use HTTPS in production
- Store secrets in Kubernetes secrets, not in values files
- Enable network policies to restrict pod-to-pod communication
- Use Pod Security Standards (restricted)
- Regular security updates and vulnerability scanning
- Monitor authentication and authorization events

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](../../LICENSE) file for details.