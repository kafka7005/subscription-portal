import asyncio
import base64
import hashlib
import json
import unittest

from pkce_store import consume_code


class Store:
    def __init__(self):
        self.value = json.dumps({"cid": "desktop", "ru": "callback", "ch": CHALLENGE})

    async def get(self, key):
        value = self.value
        await asyncio.sleep(0)
        return value

    async def delete(self, key):
        present = self.value is not None
        self.value = None
        return int(present)


VERIFIER = "v" * 48
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


class Redemption(unittest.IsolatedAsyncioTestCase):
    async def test_only_one_consumer(self):
        store = Store()
        async def redeem():
            return await consume_code(store, "code", "desktop", "callback", VERIFIER)
        results = await asyncio.gather(redeem(), redeem())
        self.assertEqual(sum(result is not None for result in results), 1)

    async def test_wrong_binding_preserves_grant(self):
        store = Store()
        for args in [("other", "callback", VERIFIER), ("desktop", "other", VERIFIER), ("desktop", "callback", "x"*48)]:
            self.assertIsNone(await consume_code(store, "code", *args))
        self.assertIsNotNone(await consume_code(store, "code", "desktop", "callback", VERIFIER))


if __name__ == "__main__":
    unittest.main()
