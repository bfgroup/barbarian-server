# Copyright 2021 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or http://www.boost.org/LICENSE_1_0.txt)

from setuptools import setup, find_packages, find_namespace_packages

setup(
    # metadata
    name='barbarian-server',
    version='0.2.0',
    description='Tools to manage Barbarian style server support.',
    url='https://barbarian.bfgroup.xyz',
    author='René Ferdinand Rivera Morell',
    author_email='grafikrobot@gmail.com',
    classifiers=[
        'Development Status :: 3 - Alpha',
        'Intended Audience :: Developers',
        'Topic :: Software Development :: Build Tools',
        'License :: OSI Approved :: Boost Software License 1.0 (BSL-1.0)',
        'Operating System :: OS Independent',
        'Programming Language :: Python :: 3'
    ],
    keywords=['C/C++', 'package', 'libraries', 'developer', 'manager',
              'dependency', 'tool', 'c', 'c++', 'cpp'],
    license='BSL 1.0',
    # options
    install_requires=[
        'conan >= 1.51.0',
        # 'barbarian >= 0.1',
        'mysql-connector-python >= 8.0.0',
        'peewee >= 3.15.2',
        'node-semver == 0.6.1',
        'ua-parser >= 0.16.1'
    ],
    package_data={'barbarians': []},
    package_dir={"": "src/tools"},
    packages=find_namespace_packages(where="src/tools"),
    python_requires=">=3.6",
    entry_points={
        'console_scripts': [
            'barbarian_rosina=barbarians.rosina.cli:main'
        ]
    }
)
