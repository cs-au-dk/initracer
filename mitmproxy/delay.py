import argparse
import re
import sys
import time

from distutils.version import LooseVersion
from subprocess import CalledProcessError, Popen, PIPE, STDOUT

p = Popen(['mitmdump --version'], stdout=PIPE, stdin=PIPE, stderr=STDOUT, shell=True)
stdout = p.communicate()[0]
mitmversion = stdout.decode()[9:] # remove "mitmdump "

if LooseVersion(mitmversion) >= LooseVersion("0.17"):
    from mitmproxy.script import concurrent
else:
    from libmproxy.script import concurrent

delayurl = None

if LooseVersion(mitmversion) >= LooseVersion("0.18"):
    def start():
        _start(sys.argv)
else:
    def start(context, argv):
        _start(argv)

def _start(argv):
    global delayurl

    parser = argparse.ArgumentParser()
    parser.add_argument('--delayurl', type=str, help='delay server response')
    args, extra_arguments = parser.parse_known_args(argv)

    if args.delayurl:
        delayurl = args.delayurl

if LooseVersion(mitmversion) >= LooseVersion("0.18"):
    def request(flow):
        _request(flow)
else:
    def request(context, flow):
        _request(flow)

def _request(flow):
    if delayurl and re.search(delayurl, flow.request.url):
        delay = 10
        print('delay request for %f s: %s' % (delay, flow.request.url))
        time.sleep(delay)
