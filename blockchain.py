import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

blockchain_setting = os.getenv(
    "BLOCKCHAIN_PATH",
    "blockchain.json"
).strip() or "blockchain.json"

blockchain_path = Path(blockchain_setting)

if not blockchain_path.is_absolute():
    blockchain_path = BASE_DIR / blockchain_path

BLOCKCHAIN_PATH = str(blockchain_path)


def utc_timestamp():
    return datetime.now(timezone.utc).isoformat()


class Block:
    def __init__(
        self,
        index,
        complaint_id,
        data,
        previous_hash,
        timestamp=None
    ):
        self.index = int(index)
        self.complaint_id = int(complaint_id)
        self.timestamp = timestamp or utc_timestamp()
        self.data = data
        self.previous_hash = previous_hash
        self.hash = self.calculate_hash()

    def calculate_hash(self):
        block_string = json.dumps(
            {
                "index": self.index,
                "complaint_id": self.complaint_id,
                "timestamp": self.timestamp,
                "data": self.data,
                "previous_hash": self.previous_hash
            },
            sort_keys=True,
            default=str
        )

        return hashlib.sha256(
            block_string.encode("utf-8")
        ).hexdigest()


class CivicBlockchain:
    """
    CITYFILE's current integrity layer is a local, file-backed SHA-256 hash
    chain. It is tamper-evident, but it is NOT an on-chain smart contract,
    public blockchain transaction, or proof that a real-world event occurred.
    """

    def __init__(self):
        self.chain = []
        self.integrity_error = None
        self._lock = threading.RLock()

        if os.path.exists(BLOCKCHAIN_PATH):
            try:
                self.load_chain()

                if not self.verify_chain():
                    raise ValueError(
                        "Stored hash chain failed verification."
                    )

                print(
                    f"CITYFILE hash chain loaded: "
                    f"{len(self.chain)} blocks"
                )
            except Exception as error:
                self.chain = []
                self.integrity_error = str(error)
                print(
                    "CITYFILE hash chain could not be verified:",
                    error
                )
        else:
            self.create_genesis_block()

    def create_genesis_block(self):
        with self._lock:
            if self.chain:
                return self.chain[0]

            genesis_block = Block(
                0,
                0,
                {
                    "event": "genesis",
                    "message": "CITYFILE local integrity chain"
                },
                "0"
            )

            self.chain.append(genesis_block)
            self.integrity_error = None
            self.save_chain()
            return genesis_block

    def add_event(self, complaint_id, data):
        with self._lock:
            if not self.chain:
                if (
                    os.path.exists(BLOCKCHAIN_PATH)
                    and self.integrity_error
                ):
                    raise RuntimeError(
                        "Integrity chain is unavailable because "
                        "the stored chain failed verification."
                    )

                self.create_genesis_block()

            previous_block = self.chain[-1]

            new_block = Block(
                len(self.chain),
                complaint_id,
                data,
                previous_block.hash
            )

            self.chain.append(new_block)

            try:
                self.save_chain()
            except Exception:
                self.chain.pop()
                raise

            return new_block

    def add_complaint(self, complaint_id, data):
        payload = dict(data or {})
        payload.setdefault(
            "event",
            "complaint_created"
        )
        return self.add_event(
            complaint_id,
            payload
        )

    def complaint_blocks(self, complaint_id):
        target = int(complaint_id)

        return [
            block
            for block in self.chain
            if block.complaint_id == target
        ]

    def complaint_anchor(self, complaint_id):
        blocks = self.complaint_blocks(
            complaint_id
        )

        return blocks[0] if blocks else None

    def save_chain(self):
        path = Path(BLOCKCHAIN_PATH)

        path.parent.mkdir(
            parents=True,
            exist_ok=True
        )

        chain_data = [
            {
                "index": block.index,
                "complaint_id": block.complaint_id,
                "timestamp": block.timestamp,
                "data": block.data,
                "previous_hash": block.previous_hash,
                "hash": block.hash
            }
            for block in self.chain
        ]

        temporary_path = path.with_name(
            f"{path.name}.tmp"
        )

        with open(
            temporary_path,
            "w",
            encoding="utf-8"
        ) as file:
            json.dump(
                chain_data,
                file,
                indent=4,
                default=str
            )
            file.flush()
            os.fsync(file.fileno())

        os.replace(
            temporary_path,
            path
        )

    def load_chain(self):
        with self._lock:
            with open(
                BLOCKCHAIN_PATH,
                "r",
                encoding="utf-8"
            ) as file:
                chain_data = json.load(file)

            if (
                not isinstance(chain_data, list)
                or not chain_data
            ):
                raise ValueError(
                    "Stored hash chain is empty or invalid."
                )

            loaded = []

            for block_data in chain_data:
                block = Block(
                    block_data["index"],
                    block_data["complaint_id"],
                    block_data["data"],
                    block_data["previous_hash"],
                    timestamp=block_data["timestamp"]
                )

                if block.hash != block_data.get("hash"):
                    raise ValueError(
                        f"Block {block.index} has been modified."
                    )

                loaded.append(block)

            self.chain = loaded
            self.integrity_error = None

    def verify_chain(self):
        if not self.chain:
            return False

        for index, current in enumerate(
            self.chain
        ):
            if current.index != index:
                return False

            if (
                current.hash
                != current.calculate_hash()
            ):
                return False

            if index == 0:
                if current.previous_hash != "0":
                    return False
                continue

            previous = self.chain[index - 1]

            if (
                current.previous_hash
                != previous.hash
            ):
                return False

        return True


blockchain = CivicBlockchain()
