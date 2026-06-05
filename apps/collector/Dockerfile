FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /collector ./cmd/collector

FROM alpine:3.19
RUN apk --no-cache add ca-certificates && \
    addgroup -S splyntra && adduser -S splyntra -G splyntra
COPY --from=builder /collector /usr/local/bin/collector

USER splyntra
EXPOSE 4318
ENTRYPOINT ["collector"]
