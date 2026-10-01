import { t } from '../../i18n';
import type { CoreVersionId } from '../xray/versions';
import { pinnedEnd, socketEnd } from '../xray/versions/finalmask-rules';

/**
 * Ready-made packets for a finalmask `noise` layer — the ones the WARP
 * profiles send ahead of WireGuard's handshake, kept here so the profiles
 * and the finalmask editor's preset buttons share one copy.
 *
 * A preset is a known-good starting point, and the same bytes for everyone
 * who picks it — which is the trade it makes. The generator ("Generate…" on
 * a noise layer) builds the same shapes with fresh identities instead, so
 * nothing about the packet is shared with another user of this editor.
 *
 * Each is one or two decoys shaped like traffic a filter lets through,
 * then four random 40-70 byte packets. The core sends the whole list once
 * per destination before the first real packet, writing it straight onto
 * whatever the noise layer wraps (v26.7.28:transport/internet/finalmask/noise/conn.go:30)
 * — the layer reads the same on 26.3, 26.7 and 26.9 and on either side.
 */

export type NoisePresetId = 'warp-a' | 'warp-b' | 'warp-c';

export interface NoiseItem {
    type?: string;
    packet?: string;
    rand?: string;
    delay?: string;
}

export interface NoisePreset {
    id: NoisePresetId;
    label: string;
    hint: string;
    noise: NoiseItem[];
}

/**
 * A QUIC v1 client Initial for www.cloudflare.com, 1232 bytes: a real one,
 * built by `scripts/build-noise-presets.ts` through the same code the
 * generator uses. It AEAD-opens with the RFC 9001 initial keys to a CRYPTO
 * frame carrying a TLS ClientHello, so a reader that parses QUIC rather than
 * glancing at the first byte sees exactly what it claims to be.
 *
 * What shipped here before did not: it declared 1232 bytes of payload in its
 * header and carried 976, which is a malformed packet any real QUIC stack
 * discards.
 */
const QUIC_INITIAL_A =
    'ce000000010853220685ab62572f0854926f95ae43b7c50044b6f4df6cdcd0d0619555cdc83ee8328d6f674a127dcdaaf96c11895c31c9a61596b4ec2bad628c5859af6aa1c68f4d88f422f3d13d6724337761071713ee542e77a0bb90f8c48bfbc0f3718221368d1d06a87dfec0b987eb0df5cfc1972b7cf9fc5f9ccd4328d665bc44739bb5c8ec54b8767f24f0dd7e14cce0a143f20fabe7bb79a4ae9d0e9892683ec50d1c7e0ec796898e49c3584bd21dd18d16e7755653ca95dd04a220e2c9e35d9e610d664881948f3b3a0d1df1980d685f8e36d48fea05cd3c812b3c682e90b55b231c72589fd4cd5b893aea92b809c10eca25c8361aad4617760ec7bc186d8edf7d73dff49feedb4a8c2acb0b1b02915b5bc2e70b54459232ce4f4cfa0ddcd150573b0989633232fb84623aa6df39568d1cde85addd8cf22504bc303b7b93dbbe152bff1df58af044b02d0a692e7060c949529c8885336f1be51bb3c187c872c3832c6635ea4afacc8d6f2053eb8ec71953c3f83c8fb3b5573305279d63804e509df03e688bef33d90c9efbd19629e8e48ae0fc744889a828817397a3c3749e86ea5d282fbf090cc0a5913d7374f11956fe188db4b491da897a00c7e19004a8ec08169ab83291b73503f2183e7b12d74da7f64460d78eb4831c2aa202fd945bd21f50a6ee0bf69e9b83437955f441d59aa3d456f4b47ac8e6d23774ed440e17c28a23d50226a06c0c8b1369790db71d63b9947ab24df8c5bc5e833de0e72f1fc29050fcfac588d65746616892d33db933807281a611df6fe058926f48688db772e47b360cfe709f35bde1f0b90073e3479f141ffd6ee1c4db173561f0663a51fada913f216136364d9237f70ebb8ab6e45956e0196809db619753dea3712606d242d6b0a2216200901f0814cd58f3257b8d79abf05f5f64e499af832c243122c334066497149f6fe259da73206b0a5533f55e1c6b84ef736a459e87ae93a066c70f335b76c1d918a79b40fac59516411d7ef503c205d19ad9a491f8c147f9cae06f7591a6835e1539b97706feb9aa9dfbb75030b8cd302b9654a9ddc983d39c23c1ed953066f1f2b1a7bd83cf33a11c4093acef7494d8944a15cab0676493d1879374b1597263287df584acb73d2a49096cc440d96a5eb3d3dc4062f644c1d70d375ad38bfbdeb1ff3e7a3756444cf6b5182e58d2fe8ca2f62bb7026febdef5458ea9d70deb1e7bb41853d6c6d2f13860740e5ad26bbc9cffe65478b26c229d81f143e4c5c8fa4c0e3d3f3efc327ca807e0bee1ce7dc396e29b9b1c6724ad5d619d9c2d41fb7a8c6dd7fca93eefcc28fb472f233e854dbbbf983ba2cec47e443b1f57dc7e6546a6950d416ffd9b0a143357eeb819ae18f6e04d2ca866c9582c97378214630b3afd0d4d8762a3787e953d5891d65e9c45ae5ef4b631b2ab92ef05432bcb5cc04f75f3e9a62dbcfe564f7d91b7d11d9bb9a9ea904510c789adb1998f633f61e5d5cdbd10ebf37a5a750d4d9d0d121359f7db26cbbded8a68e0c303ad0c4fee04429fcfd58488689d96167e3eae334460e97eb317fbfab4490477a904449c4ae25343509a79cdfb24bb021a0a8e13f35c351722defe2c89d5b0cd81bceaf47a19391cb0e05da903c98e8e2a52a67af37f87c5c47f06cea721115a1b983dbf93a09d5c0c322ec8959de7a076e1b921e443b28142d56d01d5608350efeb6d1068933ce69ffbefc91b';

/** The same, for www.google.com and 1252 bytes, so the two do not share a length. */
const QUIC_INITIAL_B =
    'cc0000000108c08f73f218cfc49c08c1ffdc021bb024320044cad99a2b55a63ab39ad8ae447b8e008fb31b132e873b4a1c613b5046ac992986e65ebf4e23dc07fd2b615770e2d234ec2b196016f78288662520cc82ac3b3b86f5af27585ac3c077a5e7540b8dc7803f4fd82f0c395ff49274d4951e5a787617121e02f71416a362320e384571a2530a37e787af353726d4ae30f2db7fb0c7a07ad25d32c6ca8687cf1f0554f2277c4bc1f7b8683ef5057a4f057bcc3d058b23996d788e9e2c33482f73652b01f6462a903ee8cb5634ba16a92287a2331694d3b91c6369c21f398d401720324d5d54cbe304c1a38195e65a3c9fbd40ad1262d2db06c1bb0593fcc5dfc7bf68379f544f41b1172b8a973142245094e021aa8fef6347db0875b78a6501d877af926b686830ca9f20a55c768da68a18a44eda3b98e044e7bd3e5366c46bef90d8f535ea8658ac79954d9d9f4b95ecbf7c4e6cc4b40455d7d49c5aebbcee0fa1e686eca7841414deb32e7cae80739d8eec5f932d2e41bc01b1b72de0abaf97f6930bf881ca894535598e2813098b634a4b8837b13ba70e5f4fe87f87902787cdb1d50a767bdb7af1e7403e6a40f7a77be98c1950ef5349824ca85ea1145e61c111a98807cee8833ad3372abb5d03019c88640849d6b89ade176bbb6d54243e251ad9d3827b25cf7aa323d0efd6cc24a81c651b2f398cff55c752751f5508d776e36f8687025017eea8f35d3aa90defb1e6cf77ab38df9f20bbf87a05ce09639276bcff05113d846b8e93b00b68bba69caf5b399eb9285d9213cdae9fc9e143c5301e6ad7d5f7fd2ce601bd604a4d9bcd1a6a36f5750ed6895eb848fb404aacc20b3dbd1752fa5ae292795aaab27786b65b28e293e2d63b402736d7cbd9b38e7d059a799fddbbaf08cdee578eb593eda6e4cbca01ae5a48f354d7eb912c2381b8479f07d9c920d9bac85bbf4bc4534eec611db60afe56763136739be9ff8d273fb33f6e9bb5d8987ce4bc1270e5eabf68f3c7162fbe889e6d3edcfe6751bf78a84f6f9e5bf5003837a4c4b50fb2e640cc676db3f3e19768af455408112700a9b5ca3e511dc4aeef4f6cb23fdbd9cb1fd06cea9e7b2e3dda433d889fb3b665d381353818f050c745f9220911a1c2908075b8b8f10bf4079e8b9df7c467d9ff484e097c5f35eb8a3fc559ec881b8555b4f86d20326ad415c2b95e281607c9482b55a67653675c8f152f804845bd942555cb24dfc86bbd0e01f0954f60c571d1cfefc1707d3f7934d222089e340a31aa2709dcca3a800b2da143d45472266ccd36cb256f6e68d3896ec0916347881f2ea3d6ed94da7303eaacd8b31ece21e294d3224833ebadba1a154ffd228c0cb323de5f6b1cad74be3b717c016b2bec459b3942666e62d89f4f4b5e942ea2b508a0f2e6958de8cef34e60a81c9c66e429351d653c400a322d1185e527bfd9cfc128707f7d97061099eebd18bd2d2728c382736c24ad8e1137a35958394ea7ae2c4de0f373c8959e38c5de70fb94bc3a37dccbdfcbbe6c8b0ae445f518b20e9356ea8d7b81ffd191dc0be71e811e814f2af101e0755fba43f3d820f0b8d40d40ecbd4c99de8b833c6668dbd70c08ef1bd448027cfc29833a8139145161427ffffb1637dc6527a6555444ac4b699f4a07eaa2f58a57be60e1b75fdc133083a7a9cd3813d4db58a584d2e750223bd84d63f45313d07eb4161245d5b49d7f5bbd2cf3b2286d9d75e69eb79848d1851862f8d36ca56b';

/** A SIP INVITE, 308 bytes: the opening of a VoIP call. */
const SIP_INVITE =
    '494e56495445207369703a626f624062696c6f78692e636f6d205349502f322e300d0a5669613a205349502f322e302f55445020706333332e61746c616e74612e636f6d3b6272616e63683d7a39684734624b3737366173646864730d0a4d61782d466f7277617264733a2037300d0a546f3a20426f62203c7369703a626f624062696c6f78692e636f6d3e0d0a46726f6d3a20416c696365203c7369703a616c6963654061746c616e74612e636f6d3b7461673d313932383330313737340d0a43616c6c2d49443a20613834623463373665363637313040706333332e61746c616e74612e636f6d0d0a435365713a2033313431353920494e564954450d0a436f6e74656e742d547970653a206170706c69636174696f6e2f7364700d0a436f6e74656e742d4c656e6774683a20300d0a0d0a';

/** The callee's "SIP/2.0 100 Trying", 294 bytes. */
const SIP_TRYING =
    '5349502f322e302031303020547279696e670d0a5669613a205349502f322e302f55445020706333332e61746c616e74612e636f6d3b6272616e63683d7a39684734624b3737366173646864730d0a4d61782d466f7277617264733a2037300d0a546f3a20426f62203c7369703a626f624062696c6f78692e636f6d3e0d0a46726f6d3a20416c696365203c7369703a616c6963654061746c616e74612e636f6d3e3b7461673d313932383330313737340d0a43616c6c2d49443a20613834623463373665363637313040706333332e61746c616e74612e636f6d0d0a435365713a2033313431353920494e564954450d0a436f6e74656e742d547970653a206170706c69636174696f6e2f7364700d0a436f6e74656e742d4c656e6774683a20300d0a0d0a';

const decoy = (packet: string): NoiseItem => ({ type: 'hex', packet, delay: '5-10' });

const randomTail = (): NoiseItem[] =>
    Array.from({ length: 4 }, () => ({ rand: '40-70', delay: '5-15' }));

const NOISE: Record<NoisePresetId, () => NoiseItem[]> = {
    'warp-a': () => [decoy(QUIC_INITIAL_A), ...randomTail()],
    'warp-b': () => [decoy(QUIC_INITIAL_B), ...randomTail()],
    'warp-c': () => [decoy(SIP_INVITE), decoy(SIP_TRYING), ...randomTail()],
};

/** A fresh copy each time: it goes into a config, which is edited in place. */
export const noiseItems = (id: NoisePresetId): NoiseItem[] => NOISE[id]();

export const noiseMask = (id: NoisePresetId) => ({ type: 'noise' as const, settings: { noise: noiseItems(id) } });

export const getNoisePresets = (): NoisePreset[] => [
    {
        id: 'warp-a',
        label: 'WARP A · QUIC',
        hint: t("A QUIC Initial for www.cloudflare.com, then four random 40-70 byte packets. The shape WARP Profile A sends."),
        noise: noiseItems('warp-a'),
    },
    {
        id: 'warp-b',
        label: 'WARP B · QUIC',
        hint: t("A QUIC Initial for www.google.com, then four random 40-70 byte packets. The shape WARP Profile B sends."),
        noise: noiseItems('warp-b'),
    },
    {
        id: 'warp-c',
        label: 'WARP C · SIP',
        hint: t("A SIP call opening (INVITE, then 100 Trying), then four random 40-70 byte packets — the noise WARP Profile C sends."),
        noise: noiseItems('warp-c'),
    },
];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const typeOf = (mask: unknown) => (isObject(mask) && typeof mask.type === 'string' ? mask.type.toLowerCase() : '');

/** One item as the core reads it: key order and a number written as a string do not change it. */
const canonical = (item: unknown): string => {
    if (!isObject(item)) return JSON.stringify(item);
    const keys = Object.keys(item).filter(key => item[key] !== undefined).sort();
    return JSON.stringify(keys.map(key => [key, typeof item[key] === 'number' ? String(item[key]) : item[key]]));
};

/** Which preset this noise list is, if it is one. */
export const matchNoisePreset = (items: unknown): NoisePresetId | null => {
    if (!Array.isArray(items)) return null;
    const mine = items.map(canonical).join('\n');
    for (const id of Object.keys(NOISE) as NoisePresetId[]) {
        if (noiseItems(id).map(canonical).join('\n') === mine) return id;
    }
    return null;
};

/**
 * `finalmask` with the preset's packets in its UDP noise layer.
 *
 * The first noise layer gets the preset's `noise` list and keeps the rest of
 * its settings (`reset`). Without one, a new layer goes at the end of the
 * list the core wraps around the socket first, so the decoys reach the wire
 * as they are instead of through another mask — just inside that end when a
 * mask there has to hold it (xicmp, realm, udphop).
 */
export const withNoisePreset = (finalmask: unknown, id: NoisePresetId, version: CoreVersionId): Json => {
    const base: Json = isObject(finalmask) ? finalmask : {};
    const udp = Array.isArray(base.udp) ? [...base.udp] : [];
    const existing = udp.findIndex(mask => typeOf(mask) === 'noise');

    if (existing !== -1) {
        const mask = udp[existing] as Json;
        const settings: Json = isObject(mask.settings) ? mask.settings : {};
        udp[existing] = { ...mask, settings: { ...settings, noise: noiseItems(id) } };
        return { ...base, udp };
    }

    const end = socketEnd(version);
    const edge = end === 'first' ? udp[0] : udp[udp.length - 1];
    const held = udp.length > 0 && pinnedEnd(version, typeOf(edge)) === end;
    const at = end === 'first' ? (held ? 1 : 0) : (held ? udp.length - 1 : udp.length);
    udp.splice(at, 0, noiseMask(id));
    return { ...base, udp };
};
