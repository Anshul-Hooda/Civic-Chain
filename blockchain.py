import hashlib
import json
from datetime import datetime


class Block:
    def __init__(self, index, complaint_id, data, previous_hash):
        self.index = index
        self.complaint_id = complaint_id
        self.timestamp = str(datetime.now())
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

        return hashlib.sha256(block_string.encode()).hexdigest()


class CivicBlockchain:
    def __init__(self):
        self.chain = []

        # First block
        genesis_block = Block(
            0,
            0,
            {"message": "CivicChain Genesis Block"},
            "0"
        )

        self.chain.append(genesis_block)

    def add_complaint(self, complaint_id, data):
        previous_block = self.chain[-1]

        new_block = Block(
            len(self.chain),
            complaint_id,
            data,
            previous_block.hash
        )

        self.chain.append(new_block)

        return new_block

    def verify_chain(self):
        for i in range(1, len(self.chain)):
            current = self.chain[i]
            previous = self.chain[i - 1]

            if current.hash != current.calculate_hash():
                return False

            if current.previous_hash != previous.hash:
                return False

        return True


blockchain = CivicBlockchain()