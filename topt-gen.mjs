import * as OTPAuth from "otpauth"

export default function generateTOTP(secret) {
  console.log("Started generating otp")
  let totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  let token = totp.generate()
  if(token) {
    console.log("OTP generated: " + token.at(0) + "***" + token.at(token.length - 1))
  }

  return token
}