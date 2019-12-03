const { ApiPromise, WsProvider, Bytes } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const testKeyring = require('@polkadot/keyring/testing');
const Jimp = require('jimp');
var promiseLimit = require('promise-limit');

const OFFSET_X = parseInt(process.env.OFFSET_X) || 0;
const OFFSET_Y = parseInt(process.env.OFFSET_Y) || 0;
const SKIP = parseInt(process.env.SKIP) || 0;

const MNEMONIC = process.env.MNEMONIC || exit(1);

function remarkPayload(offsetX, offsetY, x, y, pixel) {
    function coordToHex(coord) {
        var coord = coord.toString();
        while (coord.length < 3) {
            coord = '0' + coord;
        }
        return coord;
    }

    // payload has the following format:
    // - magic, a constant 0x1337
    // - x coord, 3 nibbles
    // - y coord, 3 nibbles
    // - color, 3 bytes, RGB.
    var payload = "0x1337";
    payload += coordToHex(offsetX + x);
    payload += coordToHex(offsetY + y);
    payload += pixel.toString(16).substring(0, 6);
    console.log(payload);
    return payload;
}

// Unravels an image into a stream of pixels.
async function* remarks(offsetX, offsetY, image) {
    let w = image.bitmap.width;
    let h = image.bitmap.height;

    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            let pixel = await image.getPixelColor(x, y);
            yield remarkPayload(offsetX, offsetY, x, y, pixel);
        }
    }
}

async function main() {
    // const provider = new WsProvider('ws://127.0.0.1:9944');
    // const provider = new WsProvider("wss://dev-node.substrate.dev:9944");
    const provider = new WsProvider("wss://kusama-rpc.polkadot.io/");

    // const api = await ApiPromise.create({ provider });
    // const api = await ApiPromise.create();
    const api = await ApiPromise.create({ provider });

    console.log("connected");

    let image = await Jimp.read("image.jpg");

    // const keyring = testKeyring.default();
    const keyring = new Keyring({ type: 'sr25519' });
    const alicePair = keyring.addFromMnemonic(MNEMONIC);
    // const alicePair = keyring.getPair(ALICE);

    // Obtain the initial account nonce for alice
    var nonce = await api.query.system.accountNonce(alicePair.address);
    var nonce = parseInt(nonce);
    console.log("expected nonce is");

    var concurrencyLimiter = promiseLimit(100);

    var promises = [];
    var skipped = 0;
    var total = 0;

    for await (remark of remarks(OFFSET_X, OFFSET_Y, image)) {
        if (skipped < SKIP) {
            skipped += 1;
            total += 1;
            continue;
        }

        let tx = api.tx.system.remark(remark).sign(alicePair, { nonce });

        let myNonce = nonce;
        promises.push(concurrencyLimiter(() => {
            return new Promise(function (resolve, reject) {
                return tx.send(({ events = [], status }) => {
                    console.log(myNonce, ': Transaction status:', status.type);
                    if (status.isFinalized) {
                        console.log(`myNonce = ${myNonce}, total = ${total}`);
                        resolve();
                    } else if (status.isDropped) {
                        resolve();
                    }
                });
            });
        }));

        if (promises.length >= 20) {
            await Promise.all(promises);
            promises = [];
        }

        nonce += 1;
        total += 1;
    }

    await Promise.all(promises);
}

main().catch(console.error).finally(() => process.exit());
