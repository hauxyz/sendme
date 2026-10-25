FROM golang:1.26-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/sendme ./cmd/server

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S sendme \
    && adduser -S sendme -G sendme

COPY --from=build /out/sendme /usr/local/bin/sendme

USER sendme
EXPOSE 8080

ENTRYPOINT ["sendme"]
