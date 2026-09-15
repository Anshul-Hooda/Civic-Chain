import hashlib
import json
import os
from datetime import datetime


# =========================================================
# STORAGE
# =========================================================

BLOCKCHAIN_PATH = os.getenv(
    "BLOCKCHAIN_PATH",
    "./blockchain.json"
)


# =========================================================
# BLOCK
# =========================================================

class Block:

    def __init__(
        self,
        index,
        complaint_id,
        data,
        previous_hash,
        timestamp=None
    ):
        self.index = index
        self.complaint_id = complaint_id

        # Keep original timestamp when loading saved blocks
        self.timestamp = timestamp or str(datetime.now())

        self.data = data
        self.previous_hash = previous_hash

        self.hash = self.calculate_hash()


    def calculate_hash(self):

        block_string = json.dumps({
            "index": self.index,
            "complaint_id": self.complaint_id,
            "timestamp": self.timestamp,
            "data": self.data,
            "previous_hash": self.previous_hash
        }, sort_keys=True)

        return hashlib.sha256(
            block_string.encode()
        ).hexdigest()


# =========================================================
# BLOCKCHAIN
# =========================================================

class CivicBlockchain:

    def __init__(self):

        self.chain = []

        # Try loading existing blockchain first
        if os.path.exists(BLOCKCHAIN_PATH):

            try:
                self.load_chain()

                if not self.verify_chain():
                    raise ValueError(
                        "Stored blockchain failed verification."
                    )

                print(
                    f"Blockchain loaded: "
                    f"{len(self.chain)} blocks"
                )

            except Exception as error:

                print(
                    "Could not load blockchain:",
                    error
                )

                self.chain = []
                self.create_genesis_block()

        else:
            self.create_genesis_block()


    # -----------------------------------------------------
    # GENESIS BLOCK
    # -----------------------------------------------------

    def create_genesis_block(self):

        genesis_block = Block(
            0,
            0,
            {"message": "CivicChain Genesis Block"},
            "0"
        )

        self.chain.append(genesis_block)

        self.save_chain()


    # -----------------------------------------------------
    # ADD COMPLAINT
    # -----------------------------------------------------

    def add_complaint(self, complaint_id, data):

        previous_block = self.chain[-1]

        new_block = Block(
            len(self.chain),
            complaint_id,
            data,
            previous_block.hash
        )

        self.chain.append(new_block)

        # Save immediately
        self.save_chain()

        return new_block


    # -----------------------------------------------------
    # SAVE BLOCKCHAIN
    # -----------------------------------------------------

    def save_chain(self):

        directory = os.path.dirname(BLOCKCHAIN_PATH)

        if directory:
            os.makedirs(
                directory,
                exist_ok=True
            )

        chain_data = []

        for block in self.chain:

            chain_data.append({
                "index": block.index,
                "complaint_id": block.complaint_id,
                "timestamp": block.timestamp,
                "data": block.data,
                "previous_hash": block.previous_hash,
                "hash": block.hash
            })

        with open(
            BLOCKCHAIN_PATH,
            "w",
            encoding="utf-8"
        ) as file:

            json.dump(
                chain_data,
                file,
                indent=4
            )


    # -----------------------------------------------------
    # LOAD BLOCKCHAIN
    # -----------------------------------------------------

    def load_chain(self):

        with open(
            BLOCKCHAIN_PATH,
            "r",
            encoding="utf-8"
        ) as file:

            chain_data = json.load(file)

        self.chain = []

        for block_data in chain_data:

            block = Block(
                block_data["index"],
                block_data["complaint_id"],
                block_data["data"],
                block_data["previous_hash"],
                timestamp=block_data["timestamp"]
            )

            # Make sure saved hash wasn't altered
            if block.hash != block_data["hash"]:
                raise ValueError(
                    f"Block {block.index} has been tampered with."
                )

            self.chain.append(block)


    # -----------------------------------------------------
    # VERIFY BLOCKCHAIN
    # -----------------------------------------------------

    def verify_chain(self):

        if not self.chain:
            return False

        for i in range(1, len(self.chain)):

            current = self.chain[i]
            previous = self.chain[i - 1]

            if current.hash != current.calculate_hash():
                return False

            if current.previous_hash != previous.hash:
                return False

        return True


# =========================================================
# CREATE BLOCKCHAIN INSTANCE
# =========================================================

blockchain = CivicBlockchain()