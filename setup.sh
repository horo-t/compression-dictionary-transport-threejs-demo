#!/bin/bash -e

readonly BROTLI_REV="779a49bfd67793f64b43015a85bc5965fba2063f"

rm -rf third_party

mkdir third_party
cd third_party

# Download brotli

git clone https://github.com/google/brotli.git
cd brotli
git checkout $BROTLI_REV

bazel build brotli

cd research/

bazel build dictionary_generator

cd ../../

mkdir three_js
cd three_js

curl https://unpkg.com/three@0.151.0/build/three.module.js -o 151.js
curl https://unpkg.com/three@0.152.0/build/three.module.js -o 152.js
curl https://unpkg.com/three@0.153.0/build/three.module.js -o 153.js

../brotli/bazel-bin/brotli 151.js -o 151.js.br
../brotli/bazel-bin/brotli 152.js -o 152.js.br
../brotli/bazel-bin/brotli 153.js -o 153.js.br
../brotli/bazel-bin/brotli 151.js -D 151.js -o 151-151.js.sbr
../brotli/bazel-bin/brotli 152.js -D 151.js -o 151-152.js.sbr
../brotli/bazel-bin/brotli 153.js -D 151.js -o 151-153.js.sbr
../brotli/bazel-bin/brotli 151.js -D 152.js -o 152-151.js.sbr
../brotli/bazel-bin/brotli 152.js -D 152.js -o 152-152.js.sbr
../brotli/bazel-bin/brotli 153.js -D 152.js -o 152-153.js.sbr
../brotli/bazel-bin/brotli 151.js -D 153.js -o 153-151.js.sbr
../brotli/bazel-bin/brotli 152.js -D 153.js -o 153-152.js.sbr
../brotli/bazel-bin/brotli 153.js -D 153.js -o 153-153.js.sbr

npm install

npm start run