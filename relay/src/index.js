// GitHub App webhooks -> workflow_dispatch for renovate
const API = 'https://api.github.com';
const enc = new TextEncoder();

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return new Response('method not allowed', { status: 405 });
        }
        const body = await request.arrayBuffer();
        if (!(await verifySignature(env.WEBHOOK_SECRET, body, request.headers.get('x-hub-signature-256')))) {
            return new Response('bad signature', { status: 401 });
        }

        const event = request.headers.get('x-github-event');
        const repo = dispatchTarget(event, JSON.parse(new TextDecoder().decode(body)), env);
        if (!repo) {
            return new Response('ignored', { status: 202 });
        }

        await dispatch(env, repo);
        return new Response(`dispatched ${repo}`, { status: 202 });
    },
};

/** Repo to run renovate for or null if the event doesn't need a run */
export function dispatchTarget(event, payload, env) {
    const repo = payload.repository?.full_name;
    if (!repo || payload.repository.owner?.login !== env.OWNER) {
        return null;
    }
    if (payload.sender?.type === 'Bot') {
        return null;
    }

    switch (event) {
        case 'issues':
            return payload.action === 'edited' && payload.changes?.body && payload.issue?.user?.login === env.BOT_LOGIN
                ? repo
                : null;
        case 'pull_request':
            return payload.action === 'edited' && payload.changes?.body && payload.pull_request?.user?.login === env.BOT_LOGIN
                ? repo
                : null;
        case 'dependabot_alert':
            return ['created', 'reopened', 'auto_reopened'].includes(payload.action) ? repo : null;
        default:
            return null;
    }
}

export async function verifySignature(secret, body, header) {
    if (!secret || !header?.startsWith('sha256=')) {
        return false;
    }
    const hex = header.slice('sha256='.length);
    if (!/^[0-9a-f]{64}$/.test(hex)) {
        return false;
    }
    const signature = Uint8Array.from(hex.match(/../g), (byte) => parseInt(byte, 16));
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('HMAC', key, signature, body);
}

async function dispatch(env, repo) {
    const jwt = await appJwt(env.DISPATCHER_CLIENT_ID, env.DISPATCHER_PRIVATE_KEY);
    const installation = await github(`/repos/${env.RUNNER_REPO}/installation`, jwt);
    const { token } = await github(`/app/installations/${installation.id}/access_tokens`, jwt, {
        repositories: [env.RUNNER_REPO.split('/')[1]],
        permissions: { actions: 'write' },
    });
    await github(`/repos/${env.RUNNER_REPO}/actions/workflows/renovate.yml/dispatches`, token, {
        ref: 'main',
        inputs: { repo },
    });
}

async function github(path, auth, body) {
    const response = await fetch(API + path, {
        method: body ? 'POST' : 'GET',
        headers: {
            authorization: `Bearer ${auth}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'renovate-relay',
        },
        body: body && JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`${response.status} from ${path}`);
    }
    return response.status === 204 ? null : response.json();
}

export async function appJwt(clientId, pem) {
    const key = await crypto.subtle.importKey('pkcs8', pkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const now = Math.floor(Date.now() / 1000);
    // clock drift, github's max is 10 min
    const unsigned = `${b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${b64url(enc.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: clientId })))}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
    return `${unsigned}.${b64url(new Uint8Array(signature))}`;
}

export function pkcs8(pem) {
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
    if (!pem.includes('BEGIN RSA PRIVATE KEY')) {
        return der;
    }
    // SEQUENCE { INTEGER 0, SEQUENCE { OID rsaEncryption, NULL }, OCTET STRING { pkcs1 } }
    const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
    const content = [0x02, 0x01, 0x00, ...algorithm, 0x04, ...derLength(der.length), ...der];
    return new Uint8Array([0x30, ...derLength(content.length), ...content]);
}

function derLength(length) {
    if (length < 0x80) {
        return [length];
    }
    const bytes = [];
    for (let rest = length; rest > 0; rest >>= 8) {
        bytes.unshift(rest & 0xff);
    }
    return [0x80 | bytes.length, ...bytes];
}

function b64url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
