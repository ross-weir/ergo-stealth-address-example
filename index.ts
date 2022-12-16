import { ExtSecretKey, Mnemonic } from "ergo-lib-wasm-nodejs";
import axios from "axios";
import { curve, ec as EC, rand } from "elliptic";
import BN from "bn.js";
import {
  TransactionBuilder,
  OutputBuilder,
  SConstant,
  SGroupElement,
  ErgoAddress,
} from "@fleet-sdk/core";
import {
  Box,
  BoxId,
  HexString,
  NonMandatoryRegisters,
  SignedTransaction,
  TransactionId,
  UnsignedTransaction,
} from "@fleet-sdk/common";

type Scenario = "receiver" | "sender";

async function getNodeConfig(): Promise<NodeConfig> {
  return {
    url: "http://localhost:9052",
    apiKey: "hello",
  };
}

async function getScenarioConfig() {
  return {
    // JUST FOR TESTING, DONT USE THIS MNEMONIC FOR YOUR WALLET
    mnemonic:
      "already hurdle fiber where state benefit april panel cause when area misery swap ahead daring",
    changeAddress: "5tFGbvzbsoK6XnEdYEZDyVb7Y4BCdhFybvJiqkmiGBzZQnPbD8as",
  };
}

// Ergo tree produced by the following script to be used for protecting stealth boxes:
// {
// val gr = SELF.R4[GroupElement].get
// val gy = SELF.R5[GroupElement].get
// val ur = SELF.R6[GroupElement].get
// val uy = SELF.R7[GroupElement].get

// proveDHTuple(gr,gy,ur,uy)
// }
const STEALTH_ADDR_ERGO_TREE = "1000cee4c6a70407e4c6a70507e4c6a70607e4c6a70707";

interface NodeConfig {
  url: string;
  apiKey: string;
}

abstract class StealthParty {
  protected readonly ec = new EC("secp256k1");
  protected readonly nodeCfg: NodeConfig;
  protected readonly currentHeight: number;

  constructor(nodeCfg: NodeConfig, currentHeight: number) {
    this.nodeCfg = nodeCfg;
    this.currentHeight = currentHeight;
  }

  protected toHexString(byteArray: any) {
    return Array.from(byteArray, function (byte: any) {
      return ("0" + (byte & 0xff).toString(16)).slice(-2);
    }).join("");
  }

  protected async signTx(
    unsignedTx: UnsignedTransaction,
    secrets?: any
  ): Promise<SignedTransaction> {
    const payload: any = {
      tx: unsignedTx,
    };

    if (!!secrets) {
      payload.secrets = secrets;
    }

    return (
      await axios.post(`${this.nodeCfg.url}/wallet/transaction/sign`, payload, {
        headers: { api_key: this.nodeCfg.apiKey },
      })
    ).data;
  }

  protected async submitTx(
    signedTx: SignedTransaction
  ): Promise<TransactionId> {
    return (await axios.post(`${this.nodeCfg.url}/transactions`, signedTx))
      .data;
  }
}

class Receiver extends StealthParty {
  private readonly secKey: ExtSecretKey;
  private readonly x: BN;
  private readonly changeAddress: ErgoAddress;

  constructor(
    nodeConfig: NodeConfig,
    currentHeight: number,
    secKey: ExtSecretKey
  ) {
    super(nodeConfig, currentHeight);

    this.secKey = secKey;
    this.x = new BN(this.secKey.secret_key_bytes());
    this.changeAddress = ErgoAddress.fromPublicKey(
      this.secKey.public_key().pub_key_bytes()
    );
  }

  private extractPointFromReg(reg: HexString): HexString {
    // SParse(reg.R4) - not implemented
    // hex of the point before serializing in register: 03f62bd72cb1c312dda006339fe29b6c8ef907b4e48f82869df131db791ad438b3
    // hex in r4: 0703f62bd72cb1c312dda006339fe29b6c8ef907b4e48f82869df131db791ad438b3
    // so if we remove the first 2 characters we should have the hex of the ec point
    return reg.slice(2);
  }

  private parseRegisters(regs: NonMandatoryRegisters): NonMandatoryRegisters {
    return {
      R4: this.extractPointFromReg(regs.R4),
      R5: this.extractPointFromReg(regs.R5),
      R6: this.extractPointFromReg(regs.R6),
      R7: this.extractPointFromReg(regs.R7),
    };
  }

  private isStealthBoxSpendable(stealthBox: Box<bigint>): boolean {
    const { curve } = this.ec;
    const parsedRegs = this.parseRegisters(stealthBox.additionalRegisters);
    const gr = curve.decodePoint(parsedRegs.R4, "hex");
    const gy = curve.decodePoint(parsedRegs.R5, "hex");
    const ur = curve.decodePoint(parsedRegs.R6, "hex");
    const uy = curve.decodePoint(parsedRegs.R7, "hex");

    return ur.eq(gr.mul(this.x)) && uy.eq(gy.mul(this.x));
  }

  payToPublicAddress(): curve.base.BasePoint {
    return this.ec.g.mul(this.x);
  }

  private async createSpendStealthBoxTx(
    stealthBox: Box<bigint>
  ): Promise<UnsignedTransaction> {
    const outputBox = new OutputBuilder(
      BigInt(stealthBox.value) / BigInt(2),
      this.changeAddress
    );

    return new TransactionBuilder(this.currentHeight)
      .from(stealthBox)
      .to(outputBox)
      .sendChangeTo(this.changeAddress)
      .payMinFee()
      .build();
  }

  private async getStealthBoxById(stealthBoxId: BoxId): Promise<Box<bigint>> {
    return (await axios.get(`${this.nodeCfg.url}/utxo/byId/${stealthBoxId}`))
      .data as Box<bigint>;
  }

  private mkSignSecretsForStealthBox(stealthBox: Box<bigint>) {
    const parsedRegs = this.parseRegisters(stealthBox.additionalRegisters);

    return {
      dht: [
        {
          secret: this.toHexString(this.secKey.secret_key_bytes()),
          g: parsedRegs.R4,
          h: parsedRegs.R5,
          u: parsedRegs.R6,
          v: parsedRegs.R7,
        },
      ],
    };
  }

  async spendStealthBox(stealthBoxId: BoxId): Promise<void> {
    const stealthBox = await this.getStealthBoxById(stealthBoxId);

    if (!this.isStealthBoxSpendable(stealthBox)) {
      console.log(`receiver: stealth box is not spendable! ${stealthBoxId}`);
      return;
    }

    const unsignedTx = await this.createSpendStealthBoxTx(stealthBox);
    const stealthBoxSecrets = this.mkSignSecretsForStealthBox(stealthBox);
    const signedTx = await this.signTx(unsignedTx, stealthBoxSecrets);

    console.log(`receiver: spend stealthbox tx id: ${signedTx.id}, submitting`);

    await this.submitTx(signedTx);

    console.log(
      `receiver: spend stealthbox transaction submitted successfully`
    );
  }
}

class Sender extends StealthParty {
  // Just get a random input box
  private async getSpendableBox(): Promise<Box<bigint>> {
    const inputsResponse = await axios.get(
      `${this.nodeCfg.url}/wallet/boxes/unspent?minConfirmations=0&maxConfirmations=-1&minInclusionHeight=0&maxInclusionHeight=-1`,
      { headers: { api_key: this.nodeCfg.apiKey } }
    );
    const boxes = inputsResponse.data as { box: Box<bigint> }[];

    // find a miner reward box so we know we have enough ergs for examples
    const { box } = boxes.find(
      ({ box }) => box.value === (67500000000 as unknown as bigint)
    );

    return box;
  }

  private mkStealthBoxRegisters(
    payablePubKey: curve.base.BasePoint
  ): NonMandatoryRegisters {
    const g = this.ec.g;
    const u = payablePubKey;
    const r = new BN(rand(32));
    const y = new BN(rand(32));
    const gr = g.mul(r);
    const gy = g.mul(y);
    const ur = u.mul(r);
    const uy = u.mul(y);

    return {
      R4: SConstant(SGroupElement(new Uint8Array(gr.encode("array", true)))),
      R5: SConstant(SGroupElement(new Uint8Array(gy.encode("array", true)))),
      R6: SConstant(SGroupElement(new Uint8Array(ur.encode("array", true)))),
      R7: SConstant(SGroupElement(new Uint8Array(uy.encode("array", true)))),
    };
  }

  private mkSendToStealthAddressTx(
    inputBox: Box<bigint>,
    regs: NonMandatoryRegisters
  ): UnsignedTransaction {
    const toBox = new OutputBuilder(
      BigInt(inputBox.value) / BigInt(2),
      STEALTH_ADDR_ERGO_TREE
    ).setAdditionalRegisters(regs);

    return new TransactionBuilder(this.currentHeight)
      .from(inputBox)
      .to(toBox)
      .sendChangeTo("5tFGbvzbsoK6XnEdYEZDyVb7Y4BCdhFybvJiqkmiGBzZQnPbD8as")
      .payMinFee()
      .build();
  }

  private extractStealthBoxId(tx: SignedTransaction): BoxId {
    return tx.outputs.find((o) => o.ergoTree === STEALTH_ADDR_ERGO_TREE).boxId;
  }

  async stealthSendToReceiver(
    receiverAddress: curve.base.BasePoint
  ): Promise<void> {
    const inputBox = await this.getSpendableBox();
    const stealthBoxRegs = this.mkStealthBoxRegisters(receiverAddress);
    const unsignedTx = this.mkSendToStealthAddressTx(inputBox, stealthBoxRegs);
    const signedTx = await this.signTx(unsignedTx);

    console.log(`sender: signed tx id ${signedTx}, submitting`);

    this.submitTx(signedTx);

    console.log("sender: submitted transaction");

    const stealthBoxId = this.extractStealthBoxId(signedTx);

    console.log(`sender: stealth box id created: ${stealthBoxId}`);
    console.log("sender: use this when running the 'receiver' scenario");
  }
}

async function runScenario(): Promise<void> {
  const args = process.argv.slice(2);
  const scenario = args[0] as Scenario;

  if (!scenario) {
    console.log("scenario not provided, 'sender' or 'receiver'", "exitting");
    return;
  }

  const nodeCfg = await getNodeConfig();
  const infoResponse = await axios.get(`${nodeCfg.url}/info`);
  const currentHeight = infoResponse.data.fullHeight;

  const scenarioConfig = await getScenarioConfig();

  const seed = Mnemonic.to_seed(scenarioConfig.mnemonic, "");
  const receiverSecretKey = ExtSecretKey.derive_master(seed);

  const receiver = new Receiver(nodeCfg, currentHeight, receiverSecretKey);
  const sender = new Sender(nodeCfg, currentHeight);

  if (scenario === "sender") {
    const receiverPublicAddress = receiver.payToPublicAddress();
    await sender.stealthSendToReceiver(receiverPublicAddress);
  }

  if (scenario === "receiver") {
    const stealthBoxId = args[1] as BoxId;

    if (!stealthBoxId) {
      console.log("receiver scenario must be ran with a stealth box id");
      console.log(
        "e.g npm run receiver -- 566843abd2781118cd0c376ec207733e1b62924c3a07f2707c26e8ea9877efb3"
      );

      return;
    }

    await receiver.spendStealthBox(stealthBoxId);
  }

  console.log("finished");
}

runScenario();
