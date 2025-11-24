#
#  Cipher/PKCS1_OAEP.py : PKCS#1 OAEP
#
# ===================================================================
# The contents of this file are dedicated to the public domain.  To
# the extent that dedication to the public domain is not available,
# everyone is granted a worldwide, perpetual, royalty-free,
# non-exclusive license to exercise all rights associated with the
# contents of this file for any purpose whatsoever.
# No rights are reserved.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
# EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
# MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
# NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
# BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
# ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
# CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
# ===================================================================

from hashlib import sha1

import Crypto.Hash.SHA1
import Crypto.Util.number
import gmpy2
from Crypto import Random
from Crypto.Signature.pss import MGF1
from Crypto.Util.number import bytes_to_long, ceil_div, long_to_bytes
from Crypto.Util.py3compat import bord
from Crypto.Util.strxor import strxor


class PKCS1OAepCipher:
    """Cipher object for PKCS#1 v1.5 OAEP.
    Do not create directly: use :func:`new` instead."""

    def __init__(self, key, hashAlgo, mgfunc, label, randfunc):
        """Initialize this PKCS#1 OAEP cipher object.

        :Parameters:
         key : an RSA key object
                If a private half is given, both encryption and decryption are possible.
                If a public half is given, only encryption is possible.
         hashAlgo : hash object
                The hash function to use. This can be a module under `Crypto.Hash`
                or an existing hash object created from any of such modules. If not specified,
                `Crypto.Hash.SHA1` is used.
         mgfunc : callable
                A mask generation function that accepts two parameters: a string to
                use as seed, and the length of the mask to generate, in bytes.
                If not specified, the standard MGF1 consistent with ``hashAlgo`` is used (a safe choice).
         label : bytes/bytearray/memoryview
                A label to apply to this particular encryption. If not specified,
                an empty string is used. Specifying a label does not improve
                security.
         randfunc : callable
                A function that returns random bytes.

        :attention: Modify the mask generation function only if you know what you are doing.
                    Sender and receiver must use the same one.
        """
        self._key = key

        if hashAlgo:
            self._hashObj = hashAlgo
        else:
            self._hashObj = Crypto.Hash.SHA1

        if mgfunc:
            self._mgf = mgfunc
        else:
            self._mgf = lambda x, y: MGF1(x, y, self._hashObj)

        self._label = bytes(label)
        self._randfunc = randfunc

    def can_encrypt(self):
        """Legacy function to check if you can call :meth:`encrypt`.

        .. deprecated:: 3.0"""
        return self._key.can_encrypt()

    def can_decrypt(self):
        """Legacy function to check if you can call :meth:`decrypt`.

        .. deprecated:: 3.0"""
        return self._key.can_decrypt()

    def encrypt(self, message):
        """Encrypt a message with PKCS#1 OAEP.

        :param message:
            The message to encrypt, also known as plaintext. It can be of
            variable length, but not longer than the RSA modulus (in bytes)
            minus 2, minus twice the hash output size.
            For instance, if you use RSA 2048 and SHA-256, the longest message
            you can encrypt is 190 byte long.
        :type message: bytes/bytearray/memoryview

        :returns: The ciphertext, as large as the RSA modulus.
        :rtype: bytes

        :raises ValueError:
            if the message is too long.
        """

        # See 7.1.1 in RFC3447
        modBits = Crypto.Util.number.size(self._key.n)
        k = ceil_div(modBits, 8)  # Convert from bits to bytes
        hLen = self._hashObj.digest_size
        mLen = len(message)

        # Step 1b
        ps_len = k - mLen - 2 * hLen - 2
        if ps_len < 0:
            raise ValueError("Plaintext is too long.")
        # Step 2a
        lHash = sha1(self._label).digest()
        # Step 2b
        ps = b"\x00" * ps_len
        # Step 2c
        db = lHash + ps + b"\x01" + bytes(message)
        # Step 2d
        ros = self._randfunc(hLen)
        # Step 2e
        dbMask = self._mgf(ros, k - hLen - 1)
        # Step 2f
        maskedDB = strxor(db, dbMask)
        # Step 2g
        seedMask = self._mgf(maskedDB, hLen)
        # Step 2h
        maskedSeed = strxor(ros, seedMask)
        # Step 2i
        em = b"\x00" + maskedSeed + maskedDB
        # Step 3a (OS2IP)
        em_int = bytes_to_long(em)
        # Step 3b (RSAEP)
        m_int = gmpy2.powmod(em_int, self._key.e, self._key.n)
        # Step 3c (I2OSP)
        c = long_to_bytes(m_int, k)
        return c

    def decrypt(self, ciphertext):
        """Decrypt a message with PKCS#1 OAEP.

        :param ciphertext: The encrypted message.
        :type ciphertext: bytes/bytearray/memoryview

        :returns: The original message (plaintext).
        :rtype: bytes

        :raises ValueError:
            if the ciphertext has the wrong length, or if decryption
            fails the integrity check (in which case, the decryption
            key is probably wrong).
        :raises TypeError:
            if the RSA key has no private half (i.e. you are trying
            to decrypt using a public key).
        """
        # See 7.1.2 in RFC3447
        modBits = Crypto.Util.number.size(self._key.n)
        k = ceil_div(modBits, 8)  # Convert from bits to bytes
        hLen = self._hashObj.digest_size
        # Step 1b and 1c
        if len(ciphertext) != k or k < hLen + 2:
            raise ValueError("Ciphertext with incorrect length.")
        # Step 2a (O2SIP)
        ct_int = bytes_to_long(ciphertext)
        # Step 2b (RSADP)
        # m_int = self._key._decrypt(ct_int)
        m_int = gmpy2.powmod(ct_int, self._key.d, self._key.n)
        # Complete step 2c (I2OSP)
        em = long_to_bytes(m_int, k)
        # Step 3a
        lHash = sha1(self._label).digest()
        # Step 3b
        y = em[0]
        # y must be 0, but we MUST NOT check it here in order not to
        # allow attacks like Manger's (http://dl.acm.org/citation.cfm?id=704143)
        maskedSeed = em[1 : hLen + 1]
        maskedDB = em[hLen + 1 :]
        # Step 3c
        seedMask = self._mgf(maskedDB, hLen)
        # Step 3d
        seed = strxor(maskedSeed, seedMask)
        # Step 3e
        dbMask = self._mgf(seed, k - hLen - 1)
        # Step 3f
        db = strxor(maskedDB, dbMask)
        # Step 3g
        one_pos = hLen + db[hLen:].find(b"\x01")
        lHash1 = db[:hLen]
        invalid = bord(y) | int(one_pos < hLen)  # type: ignore[arg-type]
        hash_compare = strxor(lHash1, lHash)
        for x in hash_compare:
            invalid |= bord(x)  # type: ignore[arg-type]
        for x in db[hLen:one_pos]:
            invalid |= bord(x)  # type: ignore[arg-type]
        if invalid != 0:
            raise ValueError("Incorrect decryption.")
        # Step 4
        return db[one_pos + 1 :]


def new(key, hashAlgo=None, mgfunc=None, label=b"", randfunc=None):
    """Return a cipher object :class:`PKCS1OAEP_Cipher`
     that can be used to perform PKCS#1 OAEP encryption or decryption.

    :param key:
      The key object to use to encrypt or decrypt the message.
      Decryption is only possible with a private RSA key.
    :type key: RSA key object

    :param hashAlgo:
      The hash function to use. This can be a module under `Crypto.Hash`
      or an existing hash object created from any of such modules.
      If not specified, `Crypto.Hash.SHA1` is used.
    :type hashAlgo: hash object

    :param mgfunc:
      A mask generation function that accepts two parameters: a string to
      use as seed, and the length of the mask to generate, in bytes.
      If not specified, the standard MGF1 consistent with ``hashAlgo`` is used (a safe choice).
    :type mgfunc: callable

    :param label:
      A label to apply to this particular encryption. If not specified,
      an empty string is used. Specifying a label does not improve
      security.
    :type label: bytes/bytearray/memoryview

    :param randfunc:
      A function that returns random bytes.
      The default is `Random.get_random_bytes`.
    :type randfunc: callable
    """

    if randfunc is None:
        randfunc = Random.get_random_bytes
    return PKCS1OAepCipher(key, hashAlgo, mgfunc, label, randfunc)
