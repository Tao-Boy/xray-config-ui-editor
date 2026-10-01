import { describe, expect, it } from 'bun:test';
import { warpAddresses, withWarpAccount, withoutWarpAccount, type WarpAccount } from './warp';
import { WARP_ENDPOINT } from '../presets';

/**
 * A WARP profile gets its keys either when it is generated or later, from
 * the outbound's own Generate WARP button. Both go through the same merge,
 * and neither may touch what the profile chose for itself — above all the
 * peer's allowedIPs, which is where "leave local networks out" lives.
 */

const account: WarpAccount = {
    id: 'id',
    token: 'token',
    privateKey: 'PRIVATE=',
    publicKey: 'PUBLIC=',
    peerPublicKey: 'PEER=',
    endpoint: '162.159.192.1:2408',
    ipv4: '172.16.0.2',
    ipv6: '2606:4700:110:8a36::1',
    reserved: [1, 2, 3],
};

const LOCAL_LEFT_OUT = ['0.0.0.0/5', '8.0.0.0/7', '::/0'];

const profile = () => ({
    secretKey: '',
    address: ['10.0.0.1/32'],
    mtu: 1280,
    reserved: [0, 0, 0],
    peers: [{ endpoint: '', publicKey: '', keepAlive: 25, allowedIPs: LOCAL_LEFT_OUT }],
});

describe('warpAddresses', () => {
    it('writes only the families the registration returned', () => {
        expect(warpAddresses(account)).toEqual(['172.16.0.2/32', '2606:4700:110:8a36::1/128']);
        expect(warpAddresses({ ipv4: '172.16.0.2', ipv6: undefined as any })).toEqual(['172.16.0.2/32']);
        expect(warpAddresses({ ipv4: '', ipv6: '' })).toEqual([]);
    });
});

describe('withWarpAccount', () => {
    it('fills in what the registration decides', () => {
        const next = withWarpAccount(profile(), account);
        expect(next.secretKey).toBe('PRIVATE=');
        expect(next.address).toEqual(['172.16.0.2/32', '2606:4700:110:8a36::1/128']);
        expect(next.reserved).toEqual([1, 2, 3]);
        expect(next.peers[0].endpoint).toBe('162.159.192.1:2408');
        expect(next.peers[0].publicKey).toBe('PEER=');
    });

    it('keeps the peer the profile chose and the rest of its settings', () => {
        const next = withWarpAccount(profile(), account);
        expect(next.peers[0].allowedIPs).toEqual(LOCAL_LEFT_OUT);
        expect(next.peers[0].keepAlive).toBe(25);
        expect(next.mtu).toBe(1280);
        const second = { endpoint: 'other:51820', publicKey: 'OTHER=' };
        expect(withWarpAccount({ ...profile(), peers: [profile().peers[0], second] }, account).peers[1]).toEqual(second);
    });

    it('starts a peer when there is none', () => {
        expect(withWarpAccount({}, account).peers).toEqual([{ keepAlive: 15, endpoint: '162.159.192.1:2408', publicKey: 'PEER=' }]);
    });
});

describe('withoutWarpAccount', () => {
    it('leaves both keys empty for the Generate WARP button to fill', () => {
        const next = withoutWarpAccount({ ...profile(), secretKey: 'stale', peers: [{ ...profile().peers[0], publicKey: 'stale' }] });
        expect(next.secretKey).toBe('');
        expect(next.peers[0].publicKey).toBe('');
    });

    it("points the peer at Cloudflare's endpoint unless it names one", () => {
        expect(withoutWarpAccount(profile()).peers[0].endpoint).toBe(WARP_ENDPOINT);
        const named = { ...profile(), peers: [{ ...profile().peers[0], endpoint: '162.159.193.5:500' }] };
        expect(withoutWarpAccount(named).peers[0].endpoint).toBe('162.159.193.5:500');
    });

    it('keeps the allowedIPs, so the button later finds them where they were', () => {
        const later = withWarpAccount(withoutWarpAccount(profile()), account);
        expect(later.peers[0].allowedIPs).toEqual(LOCAL_LEFT_OUT);
    });
});
