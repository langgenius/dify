import rsa as pyrsa
from Crypto.PublicKey import RSA

from libs import gmpy2_pkcs10aep_cipher


def test_gmpy2_pkcs10aep_cipher() -> None:
    rsa_key_pair = pyrsa.newkeys(2048)
    public_key = rsa_key_pair[0].save_pkcs1()
    private_key = rsa_key_pair[1].save_pkcs1()

    public_rsa_key = RSA.import_key(public_key)
    public_cipher_rsa2 = gmpy2_pkcs10aep_cipher.new(public_rsa_key)

    private_rsa_key = RSA.import_key(private_key)
    private_cipher_rsa = gmpy2_pkcs10aep_cipher.new(private_rsa_key)

    raw_text = "raw_text"
    raw_text_bytes = raw_text.encode()

    # RSA encryption by public key and decryption by private key
    encrypted_by_pub_key = public_cipher_rsa2.encrypt(message=raw_text_bytes)
    decrypted_by_pub_key = private_cipher_rsa.decrypt(encrypted_by_pub_key)
    assert decrypted_by_pub_key == raw_text_bytes

    # RSA encryption and decryption by private key
    encrypted_by_private_key = private_cipher_rsa.encrypt(message=raw_text_bytes)
    decrypted_by_private_key = private_cipher_rsa.decrypt(encrypted_by_private_key)
    assert decrypted_by_private_key == raw_text_bytes
