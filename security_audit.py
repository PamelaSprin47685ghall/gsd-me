import os

files = [
    "gsd-trueline/src/common/security.js",
    "gsd-trueline/src/common/hash.js",
    "gsd-trueline/src/common/parse.js",
    "gsd-trueline/src/read/reader.js",
    "gsd-trueline/src/read/line-splitter.js",
    "gsd-trueline/src/read/index.js",
    "gsd-trueline/src/read/outline.js",
    "gsd-trueline/src/read/outline-markdown.js",
    "gsd-trueline/src/read/outline-xml.js",
    "gsd-trueline/index.js"
]

for f in files:
    if os.path.exists(f):
        print(f"--- START OF FILE: {f} ---")
        with open(f, 'r') as file:
            print(file.read())
        print(f"--- END OF FILE: {f} ---\n")
    else:
        print(f"--- FILE NOT FOUND: {f} ---\n")
