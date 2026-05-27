function passwordSecureTextEntry(secureTextEntry, passwordVisible) {
  return Boolean(secureTextEntry && !passwordVisible);
}

function nextPasswordVisible(current) {
  return !current;
}

module.exports = {
  nextPasswordVisible,
  passwordSecureTextEntry,
};
