document.addEventListener("DOMContentLoaded", () => {
  // --- Configuration ---
  const LFSR_X_CONFIG = {
    name: "X",
    length: 19,
    taps: [18, 17, 16, 13], // 0-indexed from MSB
    clockBitIndex: 8,
    outputBitIndex: 18,
    elementId: "bitsX",
    clockDecisionId: "clockXDecision",
  };
  const LFSR_Y_CONFIG = {
    name: "Y",
    length: 22,
    taps: [21, 20],
    clockBitIndex: 10,
    outputBitIndex: 21,
    elementId: "bitsY",
    clockDecisionId: "clockYDecision",
  };
  const LFSR_Z_CONFIG = {
    name: "Z",
    length: 23,
    taps: [22, 21, 20, 7],
    clockBitIndex: 10,
    outputBitIndex: 22,
    elementId: "bitsZ",
    clockDecisionId: "clockZDecision",
  };

  // --- State Variables ---
  let lfsrX = [],
    lfsrY = [],
    lfsrZ = [];
  let fullKeystream = "";
  let plaintextBinary = "";
  let currentPlaintextBitIndex = 0;
  let initialized = false;

  // Initialization step tracking
  let initPhase = 0; // 0=not started, 1=zeroed, 2=key mixing, 3=frame mixing, 4=dummy clocks, 5=complete
  let initStepCounter = 0; // Counter for current phase

  // --- DOM Elements ---
  const keyInput = document.getElementById("key");
  const frameInput = document.getElementById("frame");
  const plaintextInput = document.getElementById("plaintext");
  const initializeBtn = document.getElementById("initializeBtn");
  const startInitBtn = document.getElementById("startInitBtn");
  const nextKeyBitBtn = document.getElementById("nextKeyBitBtn");
  const nextFrameBitBtn = document.getElementById("nextFrameBitBtn");
  const nextDummyClockBtn = document.getElementById("nextDummyClockBtn");
  const nextStepBtn = document.getElementById("nextStepBtn");
  const runAllBtn = document.getElementById("runAllBtn");
  const resetBtn = document.getElementById("resetBtn");

  const bitsXDiv = document.getElementById(LFSR_X_CONFIG.elementId);
  const bitsYDiv = document.getElementById(LFSR_Y_CONFIG.elementId);
  const bitsZDiv = document.getElementById(LFSR_Z_CONFIG.elementId);

  const clockXDecisionSpan = document.getElementById(
    LFSR_X_CONFIG.clockDecisionId
  );
  const clockYDecisionSpan = document.getElementById(
    LFSR_Y_CONFIG.clockDecisionId
  );
  const clockZDecisionSpan = document.getElementById(
    LFSR_Z_CONFIG.clockDecisionId
  );
  const majorityBitDisplaySpan = document.getElementById("majorityBitDisplay");

  const keystreamBitDisplaySpan = document.getElementById(
    "keystreamBitDisplay"
  );
  const fullKeystreamTextarea = document.getElementById("fullKeystream");
  const plaintextBinaryTextarea = document.getElementById("plaintextBinary");
  const ciphertextBinaryTextarea = document.getElementById("ciphertextBinary");
  const ciphertextHexSpan = document.getElementById("ciphertextHex");
  const decryptedTextSpan = document.getElementById("decryptedText");
  const logArea = document.getElementById("logArea");

  // --- Helper Functions ---
  function log(message) {
    logArea.value += message + "\n";
    logArea.scrollTop = logArea.scrollHeight; // Auto-scroll
  }

  function validateInputs(requireFullLength = true) {
    const key = keyInput.value;
    const frame = frameInput.value;

    if (requireFullLength) {
      if (!/^[01]{64}$/.test(key)) {
        alert("Key must be 64 binary digits.");
        return false;
      }
      if (!/^[01]{22}$/.test(frame)) {
        alert("Frame number must be 22 binary digits.");
        return false;
      }
    } else {
      // For step-by-step, allow any length binary string
      if (key && !/^[01]+$/.test(key)) {
        alert("Key must contain only binary digits (0 or 1).");
        return false;
      }
      if (frame && !/^[01]+$/.test(frame)) {
        alert("Frame number must contain only binary digits (0 or 1).");
        return false;
      }
    }

    if (plaintextInput.value.trim() === "") {
      alert("Plaintext cannot be empty.");
      return false;
    }
    return true;
  }

  function stringToBinary(str) {
    return str
      .split("")
      .map((char) => {
        return char.charCodeAt(0).toString(2).padStart(8, "0");
      })
      .join("");
  }

  function binaryToString(binStr) {
    let str = "";
    for (let i = 0; i < binStr.length; i += 8) {
      const byte = binStr.substring(i, i + 8);
      str += String.fromCharCode(parseInt(byte, 2));
    }
    return str;
  }

  function binaryToHex(binStr) {
    let hex = "";
    for (let i = 0; i < binStr.length; i += 4) {
      const nibble = binStr.substring(i, i + 4);
      hex += parseInt(nibble, 2).toString(16);
    }
    return hex.toUpperCase();
  }

  function renderLFSR(lfsrArray, config) {
    const div = document.getElementById(config.elementId);
    div.innerHTML = "";
    lfsrArray.forEach((bit, index) => {
      const bitSpan = document.createElement("span");
      bitSpan.classList.add("bit");
      bitSpan.textContent = bit;
      if (bit === 1) bitSpan.classList.add("one");
      else bitSpan.classList.add("zero");

      if (config.taps.includes(index)) bitSpan.classList.add("tap");
      if (index === config.clockBitIndex) bitSpan.classList.add("clock");
      if (index === config.outputBitIndex) bitSpan.classList.add("output");

      div.appendChild(bitSpan);
    });
  }

  function updateAllLFSRDisplays() {
    renderLFSR(lfsrX, LFSR_X_CONFIG);
    renderLFSR(lfsrY, LFSR_Y_CONFIG);
    renderLFSR(lfsrZ, LFSR_Z_CONFIG);
  }

  function clockLFSR(lfsrArray, config, externalInputBit = null) {
    // Calculate feedback bit
    let feedbackBit = 0;
    config.taps.forEach((tapIndex) => {
      feedbackBit ^= lfsrArray[tapIndex];
    });

    if (externalInputBit !== null) {
      feedbackBit ^= externalInputBit;
    }

    // Shift register
    for (let i = config.length - 1; i > 0; i--) {
      lfsrArray[i] = lfsrArray[i - 1];
    }
    lfsrArray[0] = feedbackBit; // New bit at MSB
    return lfsrArray[config.outputBitIndex]; // Return the (old) output bit before shift
  }

  // --- Core A5/1 Logic ---
  function startInitialization() {
    if (!validateInputs(false)) return;

    log("--- Starting Step-by-Step Initialization ---");
    lfsrX = Array(LFSR_X_CONFIG.length).fill(0);
    lfsrY = Array(LFSR_Y_CONFIG.length).fill(0);
    lfsrZ = Array(LFSR_Z_CONFIG.length).fill(0);
    log("Phase 1: LFSRs zeroed.");
    updateAllLFSRDisplays();

    initPhase = 1;
    initStepCounter = 0;

    // Update button states
    initializeBtn.disabled = true;
    startInitBtn.disabled = true;
    nextKeyBitBtn.disabled = false;
    nextFrameBitBtn.disabled = true;
    nextDummyClockBtn.disabled = true;

    const keyBits = keyInput.value.split("").map(Number);
    log(
      `Ready for key mixing. ${keyBits.length} key bits to process. Click 'Next Key Bit'.`
    );
  }

  function processNextKeyBit() {
    if (initPhase !== 1) {
      log("Error: Not in key mixing phase.");
      return;
    }

    const keyBits = keyInput.value.split("").map(Number);

    if (initStepCounter < keyBits.length) {
      const keyBit = keyBits[initStepCounter];
      clockLFSR(lfsrX, LFSR_X_CONFIG, keyBit);
      clockLFSR(lfsrY, LFSR_Y_CONFIG, keyBit);
      clockLFSR(lfsrZ, LFSR_Z_CONFIG, keyBit);
      log(
        `Key Clock ${initStepCounter + 1}/${
          keyBits.length
        }: Mixed in key bit ${keyBit}`
      );
      updateAllLFSRDisplays();
      initStepCounter++;

      if (initStepCounter >= keyBits.length) {
        log("Key mixing complete. Ready for frame number mixing.");
        initPhase = 2;
        initStepCounter = 0;

        // Update button states
        nextKeyBitBtn.disabled = true;
        nextFrameBitBtn.disabled = false;

        const frameBits = frameInput.value.split("").map(Number);
        log(
          `${frameBits.length} frame bits to process. Click 'Next Frame Bit'.`
        );
      }
    }
  }

  function processNextFrameBit() {
    if (initPhase !== 2) {
      log("Error: Not in frame mixing phase.");
      return;
    }

    const frameBits = frameInput.value.split("").map(Number);

    if (initStepCounter < frameBits.length) {
      const frameBit = frameBits[initStepCounter];
      clockLFSR(lfsrX, LFSR_X_CONFIG, frameBit);
      clockLFSR(lfsrY, LFSR_Y_CONFIG, frameBit);
      clockLFSR(lfsrZ, LFSR_Z_CONFIG, frameBit);
      log(
        `Frame Clock ${initStepCounter + 1}/${
          frameBits.length
        }: Mixed in frame bit ${frameBit}`
      );
      updateAllLFSRDisplays();
      initStepCounter++;

      if (initStepCounter >= frameBits.length) {
        log("Frame number mixing complete. Ready for 100 dummy clocks.");
        initPhase = 3;
        initStepCounter = 0;

        // Update button states
        nextFrameBitBtn.disabled = true;
        nextDummyClockBtn.disabled = false;
        nextDummyClockInput.disabled = false;

        log("100 dummy clocks to process. Click 'Next Dummy Clock'.");
      }
    }
  }

  function processNextDummyClock() {
    if (initPhase !== 3) {
      log("Error: Not in dummy clock phase.");
      return;
    }

    const totalDummyClocks = parseInt(nextDummyClockInput.value, 10) || 100;

    for (let i = 0; i < totalDummyClocks; i++) {
      if (initStepCounter < 100) {
        const clockBitX = lfsrX[LFSR_X_CONFIG.clockBitIndex];
        const clockBitY = lfsrY[LFSR_Y_CONFIG.clockBitIndex];
        const clockBitZ = lfsrZ[LFSR_Z_CONFIG.clockBitIndex];

        const majority = clockBitX + clockBitY + clockBitZ >= 2 ? 1 : 0;

        let logMsg = `Dummy Clock ${
          initStepCounter + 1
        }/100: Cx=${clockBitX}, Cy=${clockBitY}, Cz=${clockBitZ}. Majority=${majority}. `;
        let clocked = [];

        if (clockBitX === majority) {
          clockLFSR(lfsrX, LFSR_X_CONFIG);
          clocked.push("X");
        }
        if (clockBitY === majority) {
          clockLFSR(lfsrY, LFSR_Y_CONFIG);
          clocked.push("Y");
        }
        if (clockBitZ === majority) {
          clockLFSR(lfsrZ, LFSR_Z_CONFIG);
          clocked.push("Z");
        }

        clockXDecisionSpan.textContent = clocked.includes("X")
          ? `Clocked (bit ${clockBitX} == maj ${majority})`
          : `Not Clocked (bit ${clockBitX} != maj ${majority})`;
        clockYDecisionSpan.textContent = clocked.includes("Y")
          ? `Clocked (bit ${clockBitY} == maj ${majority})`
          : `Not Clocked (bit ${clockBitY} != maj ${majority})`;
        clockZDecisionSpan.textContent = clocked.includes("Z")
          ? `Clocked (bit ${clockBitZ} == maj ${majority})`
          : `Not Clocked (bit ${clockBitZ} != maj ${majority})`;

        log(logMsg + `Clocked: ${clocked.join(", ") || "None"}`);
        updateAllLFSRDisplays();
        initStepCounter++;

        if (initStepCounter >= 100) {
          log("Dummy clocks complete. Initialization finished!");
          completeInitialization();
        }
      }
    }
  }

  function completeInitialization() {
    plaintextBinary = stringToBinary(plaintextInput.value);
    plaintextBinaryTextarea.value = plaintextBinary;
    currentPlaintextBitIndex = 0;
    fullKeystream = "";
    fullKeystreamTextarea.value = "";
    ciphertextBinaryTextarea.value = "";
    ciphertextHexSpan.textContent = "-";
    decryptedTextSpan.textContent = "-";
    keystreamBitDisplaySpan.textContent = "-";

    initialized = true;
    initPhase = 4;
    nextDummyClockBtn.disabled = true;
    nextDummyClockInput.disabled = true;
    nextStepBtn.disabled = false;
    runAllBtn.disabled = false;
    log("\n--- Initialization Complete. Ready for Keystream Generation ---");
  }

  function initializeRegisters() {
    if (!validateInputs(false)) return;

    log("--- Initializing LFSRs (All at Once) ---");
    const keyBits = keyInput.value.split("").map(Number);
    const frameBits = frameInput.value.split("").map(Number);

    // 1. Zero out LFSRs
    lfsrX = Array(LFSR_X_CONFIG.length).fill(0);
    lfsrY = Array(LFSR_Y_CONFIG.length).fill(0);
    lfsrZ = Array(LFSR_Z_CONFIG.length).fill(0);
    log("1. LFSRs zeroed.");
    updateAllLFSRDisplays();

    // 2. Mix in Key (however many bits provided)
    log(`\n2. Mixing in ${keyBits.length}-bit Key:`);
    for (let i = 0; i < keyBits.length; i++) {
      const keyBit = keyBits[i];
      clockLFSR(lfsrX, LFSR_X_CONFIG, keyBit);
      clockLFSR(lfsrY, LFSR_Y_CONFIG, keyBit);
      clockLFSR(lfsrZ, LFSR_Z_CONFIG, keyBit);
      log(`   Clock ${i + 1}/${keyBits.length}: Mixed in key bit ${keyBit}`);
    }
    updateAllLFSRDisplays();
    log("   Key mixing complete.");

    // 3. Mix in Frame Number (however many bits provided)
    log(`\n3. Mixing in ${frameBits.length}-bit Frame Number:`);
    for (let i = 0; i < frameBits.length; i++) {
      const frameBit = frameBits[i];
      clockLFSR(lfsrX, LFSR_X_CONFIG, frameBit);
      clockLFSR(lfsrY, LFSR_Y_CONFIG, frameBit);
      clockLFSR(lfsrZ, LFSR_Z_CONFIG, frameBit);
      log(
        `   Clock ${i + 1}/${frameBits.length}: Mixed in frame bit ${frameBit}`
      );
    }
    updateAllLFSRDisplays();
    log("   Frame number mixing complete.");

    // 4. Run 100 "dummy" clocks (majority rule, output discarded)
    log("\n4. Running 100 dummy clocks (majority rule):");
    for (let i = 0; i < 100; i++) {
      const clockBitX = lfsrX[LFSR_X_CONFIG.clockBitIndex];
      const clockBitY = lfsrY[LFSR_Y_CONFIG.clockBitIndex];
      const clockBitZ = lfsrZ[LFSR_Z_CONFIG.clockBitIndex];

      const majority = clockBitX + clockBitY + clockBitZ >= 2 ? 1 : 0;

      let logMsg = `   Dummy Clock ${
        i + 1
      }/100: Cx=${clockBitX}, Cy=${clockBitY}, Cz=${clockBitZ}. Majority=${majority}. `;
      let clocked = [];
      if (clockBitX === majority) {
        clockLFSR(lfsrX, LFSR_X_CONFIG);
        clocked.push("X");
      }
      if (clockBitY === majority) {
        clockLFSR(lfsrY, LFSR_Y_CONFIG);
        clocked.push("Y");
      }
      if (clockBitZ === majority) {
        clockLFSR(lfsrZ, LFSR_Z_CONFIG);
        clocked.push("Z");
      }
      log(logMsg + `Clocked: ${clocked.join(", ") || "None"}`);
    }
    updateAllLFSRDisplays();
    log("   Dummy clocks complete. LFSRs initialized and mixed.");

    // Prepare for keystream generation
    plaintextBinary = stringToBinary(plaintextInput.value);
    plaintextBinaryTextarea.value = plaintextBinary;
    currentPlaintextBitIndex = 0;
    fullKeystream = "";
    fullKeystreamTextarea.value = "";
    ciphertextBinaryTextarea.value = "";
    ciphertextHexSpan.textContent = "-";
    decryptedTextSpan.textContent = "-";
    keystreamBitDisplaySpan.textContent = "-";

    initialized = true;
    initPhase = 4;

    // Disable all initialization buttons
    initializeBtn.disabled = true;
    startInitBtn.disabled = true;
    nextKeyBitBtn.disabled = true;
    nextFrameBitBtn.disabled = true;
    nextDummyClockBtn.disabled = true;
    nextDummyClockInput.disabled = true;

    // Enable keystream generation
    nextStepBtn.disabled = false;
    runAllBtn.disabled = false;

    log("\n--- Initialization Complete. Ready for Keystream Generation ---");
  }

  function generateNextKeystreamBit() {
    if (!initialized) {
      log("Error: LFSRs not initialized.");
      return null;
    }
    if (currentPlaintextBitIndex >= plaintextBinary.length) {
      log("All plaintext bits processed. Keystream generation complete.");
      nextStepBtn.disabled = true;
      runAllBtn.disabled = true;
      return null;
    }

    log(
      `\n--- Generating Keystream Bit for Plaintext Bit ${
        currentPlaintextBitIndex + 1
      } ---`
    );

    // Get clocking bits
    const clockBitX = lfsrX[LFSR_X_CONFIG.clockBitIndex];
    const clockBitY = lfsrY[LFSR_Y_CONFIG.clockBitIndex];
    const clockBitZ = lfsrZ[LFSR_Z_CONFIG.clockBitIndex];
    log(`Clocking bits: X=${clockBitX}, Y=${clockBitY}, Z=${clockBitZ}`);

    // Determine majority
    const majority = clockBitX + clockBitY + clockBitZ >= 2 ? 1 : 0;
    majorityBitDisplaySpan.textContent = majority;
    log(`Majority bit: ${majority}`);

    // Clock LFSRs based on majority
    let xClocked = false,
      yClocked = false,
      zClocked = false;
    if (clockBitX === majority) {
      clockLFSR(lfsrX, LFSR_X_CONFIG);
      xClocked = true;
      log("LFSR X clocked.");
    } else {
      log("LFSR X not clocked.");
    }
    if (clockBitY === majority) {
      clockLFSR(lfsrY, LFSR_Y_CONFIG);
      yClocked = true;
      log("LFSR Y clocked.");
    } else {
      log("LFSR Y not clocked.");
    }
    if (clockBitZ === majority) {
      clockLFSR(lfsrZ, LFSR_Z_CONFIG);
      zClocked = true;
      log("LFSR Z clocked.");
    } else {
      log("LFSR Z not clocked.");
    }

    clockXDecisionSpan.textContent = xClocked
      ? `Clocked (bit ${clockBitX} == maj ${majority})`
      : `Not Clocked (bit ${clockBitX} != maj ${majority})`;
    clockYDecisionSpan.textContent = yClocked
      ? `Clocked (bit ${clockBitY} == maj ${majority})`
      : `Not Clocked (bit ${clockBitY} != maj ${majority})`;
    clockZDecisionSpan.textContent = zClocked
      ? `Clocked (bit ${clockBitZ} == maj ${majority})`
      : `Not Clocked (bit ${clockBitZ} != maj ${majority})`;

    updateAllLFSRDisplays();

    // Get output bits
    const outputX = lfsrX[LFSR_X_CONFIG.outputBitIndex];
    const outputY = lfsrY[LFSR_Y_CONFIG.outputBitIndex];
    const outputZ = lfsrZ[LFSR_Z_CONFIG.outputBitIndex];
    log(`Output bits: X_out=${outputX}, Y_out=${outputY}, Z_out=${outputZ}`);

    // Calculate keystream bit
    const keystreamBit = outputX ^ outputY ^ outputZ;
    keystreamBitDisplaySpan.textContent = keystreamBit;
    log(
      `Generated Keystream Bit: ${outputX} XOR ${outputY} XOR ${outputZ} = ${keystreamBit}`
    );

    fullKeystream += keystreamBit;
    fullKeystreamTextarea.value = fullKeystream;

    // Encrypt/Decrypt current bit
    const currentPlaintextBit = parseInt(
      plaintextBinary[currentPlaintextBitIndex]
    );
    const ciphertextBit = currentPlaintextBit ^ keystreamBit;
    ciphertextBinaryTextarea.value += ciphertextBit;
    log(
      `Plaintext bit ${currentPlaintextBitIndex + 1}: ${currentPlaintextBit}`
    );
    log(
      `Ciphertext bit ${
        currentPlaintextBitIndex + 1
      }: ${currentPlaintextBit} XOR ${keystreamBit} = ${ciphertextBit}`
    );

    currentPlaintextBitIndex++;

    if (currentPlaintextBitIndex >= plaintextBinary.length) {
      log("\n--- All Keystream Bits Generated ---");
      finalizeEncryption();
      nextStepBtn.disabled = true;
      runAllBtn.disabled = true;
    }
    return keystreamBit;
  }

  function runAllSteps() {
    if (!initialized) {
      log("Error: LFSRs not initialized.");
      return;
    }
    log("\n--- Generating Full Keystream & Encrypting ---");
    nextStepBtn.disabled = true; // Disable while running all
    runAllBtn.disabled = true;

    function runNext() {
      if (currentPlaintextBitIndex < plaintextBinary.length) {
        generateNextKeystreamBit();
        // Use a small timeout to allow UI to update and not freeze browser for long texts
        // For very long texts, this might still be slow. A web worker would be better.
        setTimeout(runNext, 0);
      } else {
        log("Run All: Processing complete.");
      }
    }
    runNext();
  }

  function finalizeEncryption() {
    ciphertextHexSpan.textContent = binaryToHex(ciphertextBinaryTextarea.value);
    const decryptedBin = ciphertextBinaryTextarea.value
      .split("")
      .map((bit, index) => {
        return parseInt(bit) ^ parseInt(fullKeystream[index]);
      })
      .join("");
    decryptedTextSpan.textContent = binaryToString(decryptedBin);
    log(`Final Ciphertext (hex): ${ciphertextHexSpan.textContent}`);
    log(`Decrypted Text: ${decryptedTextSpan.textContent}`);
  }

  function resetApplication() {
    lfsrX = [];
    lfsrY = [];
    lfsrZ = [];
    fullKeystream = "";
    plaintextBinary = "";
    currentPlaintextBitIndex = 0;
    initialized = false;
    initPhase = 0;
    initStepCounter = 0;

    keyInput.value =
      "0101010101010101010101010101010101010101010101010101010101010101";
    frameInput.value = "1100110011001100110011";
    plaintextInput.value = "HELLO";

    bitsXDiv.innerHTML = "";
    bitsYDiv.innerHTML = "";
    bitsZDiv.innerHTML = "";
    clockXDecisionSpan.textContent = "-";
    clockYDecisionSpan.textContent = "-";
    clockZDecisionSpan.textContent = "-";
    majorityBitDisplaySpan.textContent = "-";

    keystreamBitDisplaySpan.textContent = "-";
    fullKeystreamTextarea.value = "";
    plaintextBinaryTextarea.value = "";
    ciphertextBinaryTextarea.value = "";
    ciphertextHexSpan.textContent = "-";
    decryptedTextSpan.textContent = "-";
    logArea.value = "";

    initializeBtn.disabled = false;
    startInitBtn.disabled = false;
    nextKeyBitBtn.disabled = true;
    nextFrameBitBtn.disabled = true;
    nextDummyClockBtn.disabled = true;
    nextDummyClockInput.disabled = true;
    nextStepBtn.disabled = true;
    runAllBtn.disabled = true;
    log("Application Reset.");
  }

  // --- Event Listeners ---
  initializeBtn.addEventListener("click", initializeRegisters);
  startInitBtn.addEventListener("click", startInitialization);
  nextKeyBitBtn.addEventListener("click", processNextKeyBit);
  nextFrameBitBtn.addEventListener("click", processNextFrameBit);
  nextDummyClockBtn.addEventListener("click", processNextDummyClock);
  nextStepBtn.addEventListener("click", generateNextKeystreamBit);
  runAllBtn.addEventListener("click", runAllSteps);
  resetBtn.addEventListener("click", resetApplication);

  // Initial UI setup
  resetApplication(); // Call reset to set initial state and log
  log(
    "A5/1 Visualizer loaded. Enter Key, Frame, Plaintext and click Initialize."
  );
});
