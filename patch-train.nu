#!/usr/bin/env nu
ls -f ./patches/[0-9][0-9]_* | each {|| patch -p1 -i $in.name -d ./git}
cp ./config.h git/config.h
