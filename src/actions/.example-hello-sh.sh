#!/bin/bash
# description "Hello world script"
# usage "hello-sh.sh [--debug] [--name NAME]"

echo "hello world"
echo "Args: $@"
echo "DEBUG: $debug"
echo "NAME: $name"
echo "Environment dump:"
printenv
cat -
