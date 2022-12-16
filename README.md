### ergo-stealth-address-example

Example showing how to create/send a stealth box to a recipient and spending of said box by recipient.

### Implementation

Implements the method explained [here](https://www.ergoforum.org/t/stealth-address-contract/255) by `scalahub`.

The public address posted by the receiver is one of their regular wallet public keys, the sender then follows the described procedure to generate a stealth box sent to the P2S address in the thread.

In this example we output the stealthbox id instead of searching for spendable UTXOs at the P2S address like a real application might.

### Usage

This was made as a PoC and might not run out of the box, the intention was for me to get an idea of the stealth box usage flow. To get it to run you will need to do at least the following:

- Have a node running locally (unless you update the values in `index.ts`)
- Have the rest api exposed at `http://localhost:9052` using `hello` as the API key (unless you update the values in `index.ts`)
- Have the node running in `devnet` mode (unless you update the values in `index.ts`)
- Have a utxo in your wallet with the amount of `67500000000` nanoergs (unless you update the value in `index.ts`)
- You can also update the wallet mnemonic/change address and stuff if you desire in `index.ts`

1. First run the sender scenario to create a stealth box:

```
npm run sender
```

Then you will see a message like the following with the stealth box id that was created:

```
sender: stealth box id created: e9268e0cf0ecb8e72d8eaa82024ebff83084680a79b3d53b857eed3d114b856f
```

2. Now we can run the receiver scenario to spend the stealth box:

```
npm run receiver -- e9268e0cf0ecb8e72d8eaa82024ebff83084680a79b3d53b857eed3d114b856f
```

If all went well the transaction spending the stealth box will be logged to the console, you can look this up via your node.

### Refs:

- https://www.ergoforum.org/t/stealth-address-contract/255
- https://github.com/ergoplatform/ergoscript-by-example/blob/main/stealthAddress.md
- https://github.com/aragogi/Stealth-doc
- https://github.com/ergoMixer/ergoMixBack/commit/e2febce5d99f0c64750ff803e7802a7744f26116#diff-c71899928953dbbd1a0be7155ec0ca8771add45e213b6b347dd45f0118bf786d
- https://eips.ethereum.org/EIPS/eip-5564#:~:text=A%20Stealth%20address%20is%20generated,compute%20the%20matching%20private%20key.
