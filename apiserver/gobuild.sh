#!/bin/bash

cd /go/src/github.com/ndslabs/apiserver
go get
#go build -ldflags "-X main.Version=0.1alpha -X main.BuildDate=`date "+%Y-%m-%dT%H:%M:%S"`"
GOOS=linux GOARCH=amd64 go build -o build/bin/apiserver-linux-amd64
