import * as OTPAuth from "otpauth"

export default function generateTOTP(secret) {
  let totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  let token = totp.generate()

  return token
}