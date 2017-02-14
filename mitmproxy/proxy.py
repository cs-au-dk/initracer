import argparse
import codecs
import hashlib
import json
import inspect
import os
import random
import re
import subprocess
import sys
import time
import traceback

from distutils.version import LooseVersion
from subprocess import CalledProcessError, Popen, PIPE, STDOUT
from threading import Timer

p = Popen(['mitmdump --version'], stdout=PIPE, stdin=PIPE, stderr=STDOUT, shell=True)
stdout = p.communicate()[0]
mitmversion = stdout.decode()[9:] # remove "mitmdump "

if LooseVersion(mitmversion) >= LooseVersion("0.17"):
    from mitmproxy.script import concurrent
else:
    from libmproxy.script import concurrent

initracer_dir = os.path.join(os.path.dirname(__file__), '..')
instrument_path = os.path.join(initracer_dir, 'src/instrument.js')

class bcolors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

has_html_handler = True
has_js_handler = True
mode = 'observation'
use_cache = True

html_re = re.compile('^(<!doctype)|(<html)', re.I)
sanitize_re = re.compile('(\~)|(\s)', re.I)

def handle_html(flow, content):
    if len(content.strip()) == 0:
        return ''
    return instrument(flow, content, 'html')

def handle_js(flow, content):
    return instrument(flow, content, 'js')

def looks_like_html(stripped):
    no_whitespace = stripped.replace('\xef\xbb\xbf', '') # remove zero white space characters
    return bool(re.match(html_re, no_whitespace))

def looks_like_javascript(input):
    return not looks_like_json(input) and 'SyntaxError' not in execute(os.path.join(initracer_dir, 'mitmproxy/parse-js.js'), input, None, True)['stdout']

def looks_like_json(stripped):
    try:
        json.loads(stripped)
        return True
    except:
        return False

def instrument(flow, content, ext):
    try:
        url = flow.request.orig_url if hasattr(flow.request, 'orig_url') else flow.request.url
        name = re.sub(sanitize_re, '', os.path.splitext(flow.request.path_components[-1])[0] if len(flow.request.path_components) else 'index')

        hash = hashlib.md5(content).hexdigest()
        fileName = 'cache/' + flow.request.host + '/' + hash + '/' + name + '.' + ext
        instrumentedDir = 'cache/' + flow.request.host + '/' + hash + '/'
        instrumentedFileName = instrumentedDir + name + '.' + ext
        if not os.path.exists('cache/' + flow.request.host + '/' + hash):
            os.makedirs('cache/' + flow.request.host + '/' + hash)
        if not use_cache or not os.path.isfile(instrumentedFileName):
            # print('Cache miss: ' + fileName + ' from ' + url)
            with open(fileName, 'w') as file:
                if content.startswith(codecs.BOM_UTF16):
                    file.write(content.decode('utf-16').encode('utf-8'))
                elif content.startswith(codecs.BOM_UTF16_BE):
                    file.write(content.decode('utf-16-be').encode('utf-8'))
                elif content.startswith(codecs.BOM_UTF16_LE):
                    file.write(content.decode('utf-16-le').encode('utf-8'))
                else:
                    file.write(content)
            sub_env = {
                'INITRACER_MODE': mode,
                'INITRACER_URL': url
            }
            execute(instrument_path + ' --kind ' + ext + ' --o ' + instrumentedFileName, content, sub_env)
        else:
            print('Cache hit: ' + fileName + ' from ' + url)
        with open (instrumentedFileName, "r") as file:
            data = file.read()
        return data
    except:
        print('Exception in processFile() @ proxy.py')
        exc_type, exc_value, exc_traceback = sys.exc_info()
        lines = traceback.format_exception(exc_type, exc_value, exc_traceback)
        print(''.join(lines))
        return content

if LooseVersion(mitmversion) >= LooseVersion("0.18"):
    def start():
        _start(sys.argv)
else:
    def start(context, argv):
        _start(argv)

def _start(argv):
    global mode, use_cache

    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', action='store_true', help='enable caching', default=False)
    parser.add_argument('--mode', type=str, help='which mode to use', default='observation')
    args, extra_arguments = parser.parse_known_args(argv)

    use_cache = args.cache
    mode = args.mode

def fix_url(flow):
    flow.request.orig_url = flow.request.url

    syncIdx = flow.request.url.find('sync=')
    if syncIdx >= 0:
        sync = flow.request.url[syncIdx+5:]
        remainderIdx = sync.find('&')
        if remainderIdx >= 0:
            flow.request.url = flow.request.url[0:syncIdx-1] + sync[remainderIdx:]
            sync = sync[0:remainderIdx]
        else:
            flow.request.url = flow.request.url[0:syncIdx-1]

if LooseVersion(mitmversion) >= LooseVersion("0.18"):
    def request(flow):
        _request(flow)
else:
    def request(context, flow):
        _request(flow)

def _request(flow):
    fix_url(flow)

if LooseVersion(mitmversion) >= LooseVersion("0.18"):
    @concurrent
    def response(flow):
        _response(flow)
else:
    @concurrent
    def response(context, flow):
        _response(flow)

def _response(flow):
    url = flow.request.url

    if flow.error:
        print('Error: ' + str(flow.error))
    else:
        try:
            flow.response.decode()

            content_type = None
            content_type_key = 'Content-Type'
            cors_key = "Access-Control-Allow-Origin"
            acac_key = "Access-Control-Allow-Credentials"
            csp_key = None
            location_key = None
            origin_key = "Origin"
            set_cookie_key = None

            if flow.response.status_code == 204:
                # No Content and a JavaScript request: change the status code such
                # that the code is instrumented (necessary for the 'script execute' hook)
                flow.response.status_code = 200
                content_type = 'text/javascript'

            if flow.request.path.endswith('.js') or hasattr(flow.request, 'alloc_num'):
                content_type = 'text/javascript'
            elif flow.request.path.endswith('.html'):
                content_type = 'text/html'

            for key in flow.response.headers.keys():
                if key.lower() == 'access-control-allow-origin':
                    cors_key = key
                if key.lower() == 'access-control-allow-credentials':
                    acac_key = key
                elif key.lower() == 'content-security-policy':
                    csp_key = key
                elif key.lower() == 'location':
                    location_key = key
                elif key.lower() == 'origin':
                    origin_key = key
                elif key.lower() == 'set-cookie':
                    set_cookie_key = key
                elif key.lower() == 'content-type':
                    content_type_key = key
                    if not content_type:
                        content_type = flow.response.headers[key].lower()

            if (flow.response.status_code == 301 or flow.response.status_code == 302) and location_key and hasattr(flow.request, 'custom_query') and len(flow.request.custom_query) > 0:
                location = flow.response.headers[location_key]
                if location.find('?') >= 0:
                    flow.response.headers[location_key] = location + '&' + '&'.join(flow.request.custom_query)
                else:
                    flow.response.headers[location_key] = location + '?' + '&'.join(flow.request.custom_query)

            content_type = infer_content_type(url, flow.response.content, content_type)
            if content_type == 'text/html':
                if has_html_handler:
                    flow.response.content = handle_html(flow, flow.response.content)
                flow.response.headers[content_type_key] = 'text/html; charset=utf-8'
            elif content_type == 'text/javascript':
                # set 500 to generate an error event, if the server returned
                # an HTML error page for the script...
                if looks_like_html(flow.response.content):
                    flow.response.status_code = 500
                    flow.response.content = 'console.error("UNEXPECTED");'
                elif has_js_handler:
                    flow.response.content = handle_js(flow, flow.response.content)
                flow.response.headers[content_type_key] = 'text/javascript'

            # For some reason a redirect loop occurs in the replay for ford.com
            if location_key and flow.request.url == flow.response.headers[location_key]:
                flow.response.headers.pop(location_key, None)
                flow.response.status_code = 500

            # Enable CORS
            if acac_key in flow.response.headers and flow.response.headers[acac_key] == 'true' and origin_key in flow.request.headers:
                flow.response.headers[cors_key] = flow.request.headers[origin_key]
            else:
                flow.response.headers[cors_key] = '*'

            # Disable the content security policy since it may prevent instrumented code from executing
            if csp_key:
                flow.response.headers.pop(csp_key, None)
        except:
            print('Exception in response() @ proxy.py')
            exc_type, exc_value, exc_traceback = sys.exc_info()
            lines = traceback.format_exception(exc_type, exc_value, exc_traceback)
            print(''.join(lines))

def infer_content_type(url, data, content_type, infer=False):
    stripped = data.strip()
    if content_type:
        if content_type.find('html') >= 0:
            if len(stripped) == 0 or looks_like_html(stripped):
                return 'text/html'
            print(bcolors.WARNING + 'Warning: \'%s\' does not look like HTML, but Content-Type was \'%s\'' % (url, content_type) + bcolors.ENDC)
            print('Source: %s' % (stripped if len(stripped) < 100 else stripped[:100]))
            if looks_like_javascript(stripped):
                return 'text/javascript'
        elif looks_like_html(stripped):
            print(bcolors.WARNING + 'Warning: \'%s\' looks like HTML, but Content-Type was \'%s\'' % (url, content_type) + bcolors.ENDC)
            print('Source: %s' % (stripped if len(stripped) < 100 else stripped[:100]))

        if content_type.find('javascript') >= 0:
            return 'text/javascript'
        elif content_type.find('json') < 0 and stripped and looks_like_javascript(stripped):
            print(bcolors.WARNING + 'Warning: \'%s\' looks like JavaScript, but Content-Type was \'%s\'' % (url, content_type) + bcolors.ENDC)
            print('Source: %s' % (stripped if len(stripped) < 100 else stripped[:100]))
    elif stripped:
        if looks_like_html(stripped):
            print(bcolors.WARNING + 'Warning: \'%s\' looks like HTML, but Content-Type was missing' % (url) + bcolors.ENDC)
            print('Source: %s' % (stripped if len(stripped) < 100 else stripped[:100]))
        elif looks_like_javascript(stripped):
            print(bcolors.WARNING + 'Warning: \'%s\' looks like JavaScript, but Content-Type was missing' % (url) + bcolors.ENDC)
            print('Source: %s' % (stripped if len(stripped) < 100 else stripped[:100]))
    
    return content_type

def encode_input(input):
    if input.startswith(codecs.BOM_UTF16):
        return input.decode('utf-16').encode('utf-8')
    elif input.startswith(codecs.BOM_UTF16_BE):
        return input.decode('utf-16-be').encode('utf-8')
    elif input.startswith(codecs.BOM_UTF16_LE):
        return input.decode('utf-16-le').encode('utf-8')
    return input

def execute(script, stdin=None, env=None, quiet=False):
    """Execute script and print output"""
    try:
        cmd = ["node"] + script.split()
        sub_env = os.environ.copy()
        if (env):
            for key in env.keys():
                sub_env[key] = env[key]
        # print(' '.join(cmd))
        p = Popen(cmd, env=sub_env, stdin=PIPE, stdout=PIPE, stderr=subprocess.STDOUT)
        stdout = p.communicate(input=encode_input(stdin) if stdin else None)[0]
        if not quiet and len(stdout) > 0:
            print(stdout)
        return { 'stdout': stdout, 'returncode': p.returncode }
    except subprocess.CalledProcessError, e:
        print(e.output)
    return { 'stdout': e.output, 'returncode': 1 }
