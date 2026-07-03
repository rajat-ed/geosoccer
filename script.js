document.addEventListener('DOMContentLoaded', () => {

    // --- Game Constants ---
    const FIELD_WIDTH = 800; // Base width for calculations
    const FIELD_HEIGHT = 400; // Base height for calculations
    const PLAYER_SIZE = 40;
    const TEAMMATE_SIZE = 35;
    const OPPONENT_SIZE = 35;
    const BALL_SIZE = 20;

    const MAX_MISSES = 3;
    const PASS_ANIMATION_DURATION = 400; // ms
    const KICK_OUTCOME_DISPLAY_DURATION = 1000; // ms

    // Player starting position (relative to field dimensions)
    const PLAYER_START_X_RATIO = 0.5;
    const PLAYER_START_Y_RATIO = 0.90;

    // Goal line Y position (top of the field)
    const GOAL_LINE_Y = 0; // Top edge of the field

    // Opponent and Teammate placement constraints
    const MIN_DISTANCE_ENTITIES = 60; // Minimum distance between any two entities
    const TEAMMATE_MIN_Y_RATIO = 0.1; // Teammate must be in the top 90% of the field
    const TEAMMATE_MAX_Y_RATIO = 0.8; // Teammate cannot be too close to the player
    const OPPONENT_Y_MIN = FIELD_HEIGHT * 0.1; // Opponents should be further up the field
    const OPPONENT_Y_MAX = FIELD_HEIGHT * 0.7; // Opponents should not be too close to player
    const OPPONENT_X_MARGIN = 50; // Opponents shouldn't be right on the field edge

    // --- Game State (Global Object for easier management) ---
    const gameState = {
        gameStage: 'nameInput', // 'nameInput', 'difficultySelect', 'playing', 'gameOver'
        playerName: '',
        score: 0,
        misses: 0,
        currentDifficulty: { level: 'easy', tolerance: 10 },
        playerInputAngle: 90, // Default angle
        teammatePosition: { x: 0, y: 0 },
        opponentPositions: [],
        ballPosition: { x: 0, y: 0 },
        ballTargetPosition: { x: 0, y: 0 },
        isPassing: false, // Flag to disable input during animation
        kickOutcome: null, // 'goal', 'pass_success', 'miss', null
        lastPassFeedback: '',
        animationFrameId: null, // To store requestAnimationFrame ID
        ballAnimationStartTime: 0,
    };

    // --- DOM Elements ---
    const nameInputScreen = document.getElementById('name-input-screen');
    const playerNameInput = document.getElementById('player-name');
    const nextButton = document.getElementById('next-button');

    const difficultyScreen = document.getElementById('difficulty-screen');
    const welcomeMessage = document.getElementById('welcome-message');
    const difficultyOptions = document.querySelectorAll('input[name="difficulty"]');
    const startGameButton = document.getElementById('start-game-button');

    const playingScreen = document.getElementById('playing-screen');
    const displayPlayerName = document.getElementById('display-player-name');
    const displayScore = document.getElementById('display-score');
    const displayDifficulty = document.getElementById('display-difficulty');
    const displayMisses = document.getElementById('display-misses');
    const maxMissesDisplay = document.getElementById('max-misses');

    const footballField = document.getElementById('football-field');
    const playerEntity = document.getElementById('player-entity');
    const teammateEntity = document.getElementById('teammate-entity');
    const ballEntity = document.getElementById('ball-entity');
    const opponentEntities = [
        document.getElementById('opponent-1'),
        document.getElementById('opponent-2'),
        document.getElementById('opponent-3'),
    ];
    const goalLineGuide = document.getElementById('goal-line-guide');
    const trajectoryGuideLine = document.getElementById('trajectory-guide-line');
    const animatedKickOutcome = document.getElementById('animated-kick-outcome');

    const angleInput = document.getElementById('angle-input');
    const passButton = document.getElementById('pass-button');
    const angleError = document.getElementById('angle-error');
    const passFeedback = document.getElementById('pass-feedback');

    const gameOverScreen = document.getElementById('game-over-screen');
    const finalScoreMessage = document.getElementById('final-score-message');
    const playAgainButton = document.getElementById('play-again-button');

    const currentYearSpan = document.getElementById('current-year');

    // --- Utility Functions ---

    /**
     * Converts degrees to radians.
     * @param {number} degrees
     * @returns {number} radians
     */
    function degreesToRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Calculates the angle in degrees from a starting position to a target position.
     * Angle is 0-360, where 0 is right, 90 is up (screen coordinates).
     * @param {{x: number, y: number}} startPos
     * @param {{x: number, y: number}} targetPos
     * @returns {number} angle in degrees (0-360)
     */
    function calculateAngleToPosition(startPos, targetPos) {
        const dx = targetPos.x - startPos.x;
        const dy = startPos.y - targetPos.y; // Invert Y for screen coordinates (Y increases downwards)
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle < 0) {
            angle += 360;
        }
        return angle;
    }

    /**
     * Calculates if a point is near a line segment.
     * @param {{x: number, y: number}} point
     * @param {{x: number, y: number}} lineStart
     * @param {{x: number, y: number}} lineEnd
     * @param {number} tolerance
     * @returns {boolean}
     */
    function isPointNearLineSegment(point, lineStart, lineEnd, tolerance) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const lengthSq = dx * dx + dy * dy;

        if (lengthSq === 0) { // Line start and end are the same point
            return Math.hypot(point.x - lineStart.x, point.y - lineStart.y) <= tolerance;
        }

        // Project point onto the line segment
        const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSq;
        let closestX, closestY;

        if (t < 0) {
            closestX = lineStart.x;
            closestY = lineStart.y;
        } else if (t > 1) {
            closestX = lineEnd.x;
            closestY = lineEnd.y;
        } else {
            closestX = lineStart.x + t * dx;
            closestY = lineStart.y + t * dy;
        }

        // Calculate distance from the closest point on the segment to the given point
        const distance = Math.hypot(point.x - closestX, point.y - closestY);
        return distance <= tolerance;
    }

    /**
     * Checks if a proposed position is too close to any existing entity or boundary.
     * @param {{x: number, y: number}} pos The position to check.
     * @param {number} size The size of the entity being placed.
     * @param {Array<{x: number, y: number}>} existingPositions Array of already placed entity positions.
     * @param {number} minDistance Minimum required distance from existing entities.
     * @param {number} fieldWidth Width of the field.
     * @param {number} fieldHeight Height of the field.
     * @returns {boolean} True if safe, false if too close or out of bounds.
     */
    function isPositionSafe(pos, size, existingPositions, minDistance, fieldWidth, fieldHeight) {
        // Check against field boundaries
        if (pos.x - size / 2 < 0 || pos.x + size / 2 > fieldWidth ||
            pos.y - size / 2 < 0 || pos.y + size / 2 > fieldHeight) {
            return false;
        }

        // Check against existing entities
        for (const existingPos of existingPositions) {
            const distance = Math.hypot(pos.x - existingPos.x, pos.y - existingPos.y);
            if (distance < minDistance) {
                return false;
            }
        }
        return true;
    }

    /**
     * Updates the CSS position of a DOM element.
     * @param {HTMLElement} element
     * @param {{x: number, y: number}} pos
     * @param {number} size The size of the element (width/height)
     */
    function updateElementPosition(element, pos, size) {
        element.style.left = `${pos.x - size / 2}px`;
        element.style.top = `${pos.y - size / 2}px`;
        element.style.width = `${size}px`;
        element.style.height = `${size}px`;
    }

    // --- Game Logic Functions ---

    /**
     * Generates a random position for the teammate.
     * @param {{x: number, y: number}} playerPos
     * @param {number} fieldWidth
     * @param {number} fieldHeight
     * @returns {{x: number, y: number}}
     */
    function generateRandomTeammatePosition(playerPos, fieldWidth, fieldHeight) {
        let newPos;
        let attempts = 0;
        const maxAttempts = 100; // Prevent infinite loops

        const goalX = fieldWidth / 2;
        const goalY = GOAL_LINE_Y + 10; // Slightly below top edge

        do {
            // 1/6 chance to be near center goal
            if (Math.random() < 1 / 6) {
                newPos = {
                    x: goalX + (Math.random() - 0.5) * (fieldWidth * 0.1), // Slightly off center
                    y: GOAL_LINE_Y + 30 + Math.random() * 50 // Near goal line
                };
            } else {
                // Place in opponent's half, generally forward
                newPos = {
                    x: Math.random() * fieldWidth,
                    y: fieldHeight * TEAMMATE_MIN_Y_RATIO + Math.random() * (fieldHeight * (TEAMMATE_MAX_Y_RATIO - TEAMMATE_MIN_Y_RATIO))
                };
            }
            attempts++;
        } while (!isPositionSafe(newPos, TEAMMATE_SIZE, [playerPos], MIN_DISTANCE_ENTITIES, fieldWidth, fieldHeight) && attempts < maxAttempts);

        if (attempts === maxAttempts) {
            console.warn("Could not find a safe teammate position, placing forcefully.");
            // Fallback: place it somewhat safely
            newPos = { x: fieldWidth / 2, y: fieldHeight * 0.3 };
        }

        return newPos;
    }

    /**
     * Generates positions for opponents.
     * @param {number} count Number of opponents.
     * @param {{x: number, y: number}} playerPos
     * @param {{x: number, y: number}} teammatePos
     * @param {number} fieldWidth
     * @param {number} fieldHeight
     * @returns {Array<{x: number, y: number}>}
     */
    function generateOpponentPositions(count, playerPos, teammatePos, fieldWidth, fieldHeight) {
        const positions = [];
        const playerToTeammateTolerance = MIN_DISTANCE_ENTITIES + 10; // Slightly more tolerance
        const teammateToGoalTolerance = MIN_DISTANCE_ENTITIES + 10;
        const goalCenter = { x: fieldWidth / 2, y: GOAL_LINE_Y };

        for (let i = 0; i < count; i++) {
            let newPos;
            let attempts = 0;
            const maxAttempts = 200;

            do {
                newPos = {
                    x: OPPONENT_X_MARGIN + Math.random() * (fieldWidth - 2 * OPPONENT_X_MARGIN),
                    y: OPPONENT_Y_MIN + Math.random() * (OPPONENT_Y_MAX - OPPONENT_Y_MIN)
                };
                attempts++;

                if (attempts === maxAttempts) {
                    console.warn(`Could not find safe position for opponent ${i + 1}, placing forcefully.`);
                    newPos = { x: fieldWidth / 2, y: fieldHeight * 0.4 }; // Fallback
                    break;
                }

            } while (!isPositionSafe(newPos, OPPONENT_SIZE, [playerPos, teammatePos, ...positions], MIN_DISTANCE_ENTITIES, fieldWidth, fieldHeight) ||
                     isPointNearLineSegment(newPos, playerPos, teammatePos, playerToTeammateTolerance) ||
                     isPointNearLineSegment(newPos, teammatePos, goalCenter, teammateToGoalTolerance));

            positions.push(newPos);
        }
        return positions;
    }


    /**
     * Calculates the shortest angular distance between two angles (0-180).
     * @param {number} angle1
     * @param {number} angle2
     * @returns {number} absolute difference
     */
    function getShortestAngleDifference(angle1, angle2) {
        let diff = Math.abs(angle1 - angle2);
        if (diff > 180) {
            diff = 360 - diff;
        }
        return diff;
    }

    /**
     * Checks if the pass is successful based on angle tolerance.
     * @param {number} playerInputAngle User's input angle (0-180)
     * @param {number} actualAngleToTeammate Angle to teammate (0-360)
     * @param {number} tolerance
     * @returns {boolean}
     */
    function checkPassSuccess(playerInputAngle, actualAngleToTeammate, tolerance) {
        // Normalize actualAngleToTeammate to 0-180 for comparison (reflect angles > 180)
        let normalizedActualAngle = actualAngleToTeammate;
        if (normalizedActualAngle > 180) {
            normalizedActualAngle = 360 - normalizedActualAngle;
        }

        const angleDifference = getShortestAngleDifference(playerInputAngle, normalizedActualAngle);
        return angleDifference <= tolerance;
    }

    /**
     * Animates the ball movement.
     * @param {{x: number, y: number}} startPos
     * @param {{x: number, y: number}} targetPos
     * @param {number} duration
     * @param {Function} onComplete Callback when animation finishes
     */
    function animateBall(startPos, targetPos, duration, onComplete) {
        if (gameState.animationFrameId) {
            cancelAnimationFrame(gameState.animationFrameId);
        }

        gameState.ballAnimationStartTime = performance.now();

        function frame(currentTime) {
            const elapsed = currentTime - gameState.ballAnimationStartTime;
            const progress = Math.min(elapsed / duration, 1);

            const currentX = startPos.x + (targetPos.x - startPos.x) * progress;
            const currentY = startPos.y + (targetPos.y - startPos.y) * progress;

            gameState.ballPosition = { x: currentX, y: currentY };
            updateElementPosition(ballEntity, gameState.ballPosition, BALL_SIZE);

            if (progress < 1) {
                gameState.animationFrameId = requestAnimationFrame(frame);
            } else {
                // Animation complete
                if (onComplete) {
                    onComplete();
                }
                gameState.animationFrameId = null;
            }
        }
        gameState.animationFrameId = requestAnimationFrame(frame);
    }

    /**
     * Displays an animated text overlay on the field.
     * @param {string} text
     * @param {string} color
     */
    function showKickOutcomeText(text, color = 'var(--accent-yellow)') {
        animatedKickOutcome.textContent = text;
        animatedKickOutcome.style.color = color;
        animatedKickOutcome.classList.add('show');

        setTimeout(() => {
            animatedKickOutcome.classList.remove('show');
            animatedKickOutcome.textContent = ''; // Clear text after animation
        }, KICK_OUTCOME_DISPLAY_DURATION);
    }


    // --- Game Flow & UI Update Functions ---

    /**
     * Switches between game screens.
     * @param {string} screenName The ID of the screen to show (e.g., 'name-input-screen')
     */
    function showScreen(screenName) {
        const screens = document.querySelectorAll('.game-screen');
        screens.forEach(screen => {
            screen.classList.remove('active');
            screen.classList.add('hidden');
        });
        document.getElementById(screenName).classList.remove('hidden');
        document.getElementById(screenName).classList.add('active');

        // Focus handling for accessibility
        if (screenName === 'name-input-screen') {
            playerNameInput.focus();
        } else if (screenName === 'difficulty-screen') {
            startGameButton.focus();
        } else if (screenName === 'playing-screen') {
            angleInput.focus();
        } else if (screenName === 'game-over-screen') {
            playAgainButton.focus();
        }
    }

    /**
     * Initializes a new game challenge (new teammate, opponents).
     */
    function setupNewChallenge() {
        gameState.isPassing = false;
        gameState.kickOutcome = null;
        gameState.lastPassFeedback = '';
        passFeedback.textContent = '';
        angleError.textContent = '';
        angleInput.value = '90'; // Reset angle input
        gameState.playerInputAngle = 90; // Reset internal state

        // Determine current player position (centered on the baseline)
        const playerPos = {
            x: FIELD_WIDTH * PLAYER_START_X_RATIO,
            y: FIELD_HEIGHT * PLAYER_START_Y_RATIO
        };
        updateElementPosition(playerEntity, playerPos, PLAYER_SIZE);


        // Position the dashed baseline guide
        goalLineGuide.style.top = `${playerPos.y}px`;

        gameState.teammatePosition = generateRandomTeammatePosition(playerPos, FIELD_WIDTH, FIELD_HEIGHT);
        updateElementPosition(teammateEntity, gameState.teammatePosition, TEAMMATE_SIZE);

        gameState.opponentPositions = generateOpponentPositions(3, playerPos, gameState.teammatePosition, FIELD_WIDTH, FIELD_HEIGHT);
        opponentEntities.forEach((opp, index) => {
            updateElementPosition(opp, gameState.opponentPositions[index], OPPONENT_SIZE);
            opp.style.display = 'block'; // Ensure opponents are visible
        });

        // Reset ball to player's position
        gameState.ballPosition = { ...playerPos };
        updateElementPosition(ballEntity, gameState.ballPosition, BALL_SIZE);

        updateTrajectoryGuide(); // Update guide line initially
        updateGameUI(); // Update score, misses, etc.
    }

    /**
     * Updates all dynamic UI elements.
     */
    function updateGameUI() {
        displayPlayerName.textContent = gameState.playerName;
        displayScore.textContent = gameState.score;
        displayDifficulty.textContent = gameState.currentDifficulty.level.charAt(0).toUpperCase() + gameState.currentDifficulty.level.slice(1);
        displayMisses.textContent = gameState.misses;
        maxMissesDisplay.textContent = MAX_MISSES;

        // Adjust pass button and angle input state
        if (gameState.isPassing) {
            angleInput.disabled = true;
            passButton.disabled = true;
        } else {
            angleInput.disabled = false;
            passButton.disabled = false;
        }
    }

    /**
     * Updates the visual trajectory guide line based on player's input angle.
     */
    function updateTrajectoryGuide() {
        if (gameState.isPassing) {
            trajectoryGuideLine.style.display = 'none'; // Hide during animation
            return;
        }

        trajectoryGuideLine.style.display = 'block';
        const playerPos = {
            x: FIELD_WIDTH * PLAYER_START_X_RATIO,
            y: FIELD_HEIGHT * PLAYER_START_Y_RATIO
        };

        // Angle 0 is right, 90 is up, 180 is left (player's perspective)
        // Convert to screen angle: 90 input means straight up (270 in standard math, but we need to rotate around player)
        // 0 input means right (0 in standard math)
        // 180 input means left (180 in standard math)
        const angleInRadians = degreesToRadians(gameState.playerInputAngle); // Adjust for screen Y-axis (up is negative)

        // A fixed visual length for the guide line
        const guideLineLength = 200;

        // Calculate end point for the line
        const endX = playerPos.x + guideLineLength * Math.cos(angleInRadians);
        const endY = playerPos.y - guideLineLength * Math.sin(angleInRadians); // Subtract for screen Y-axis

        // Set position and rotation
        trajectoryGuideLine.style.width = `${guideLineLength}px`;
        trajectoryGuideLine.style.left = `${playerPos.x}px`;
        trajectoryGuideLine.style.top = `${playerPos.y}px`;
        trajectoryGuideLine.style.transform = `rotate(${-gameState.playerInputAngle}deg)`; // Rotate based on input angle
        trajectoryGuideLine.style.transformOrigin = `0% 50%`; // Rotate from the player's center relative to line
    }


    /**
     * Handles the pass action when the button is clicked or Enter is pressed.
     */
    function handlePassRequested() {
        if (gameState.isPassing) return; // Prevent multiple passes during animation

        const inputValue = parseInt(angleInput.value, 10);

        // Input validation
        if (isNaN(inputValue) || inputValue < 0 || inputValue > 180) {
            angleError.textContent = "Angle must be 0-180.";
            passFeedback.textContent = "";
            return;
        }
        angleError.textContent = ""; // Clear error if valid

        gameState.playerInputAngle = inputValue;
        gameState.isPassing = true;
        updateGameUI(); // Disable input

        const playerPos = {
            x: FIELD_WIDTH * PLAYER_START_X_RATIO,
            y: FIELD_HEIGHT * PLAYER_START_Y_RATIO
        };

        const actualAngleToTeammate = calculateAngleToPosition(playerPos, gameState.teammatePosition);
        const isSuccessfulPass = checkPassSuccess(gameState.playerInputAngle, actualAngleToTeammate, gameState.currentDifficulty.tolerance);

        gameState.lastPassFeedback = `Your pass: ${inputValue}° | Teammate at: ${actualAngleToTeammate.toFixed(1)}° | Result: `;

        if (isSuccessfulPass) {
            gameState.ballTargetPosition = { ...gameState.teammatePosition };
            gameState.kickOutcome = 'pass_success';
            gameState.lastPassFeedback += 'SUCCESS!';
            passFeedback.style.color = 'var(--primary-green)';
            showKickOutcomeText('PASS!', 'var(--primary-green)');
        } else {
            gameState.misses++;
            gameState.kickOutcome = 'miss';
            gameState.lastPassFeedback += 'MISS!';
            passFeedback.style.color = 'var(--opponent-red)';
            showKickOutcomeText('MISS!', 'var(--opponent-red)');

            // Calculate miss target position based on input angle
            const angleInRadians = degreesToRadians(gameState.playerInputAngle); // Adjust for screen Y-axis
            const missDistance = 200; // Fixed distance for a missed pass

            let missTargetX = playerPos.x + missDistance * Math.cos(angleInRadians);
            let missTargetY = playerPos.y - missDistance * Math.sin(angleInRadians); // Subtract for screen Y-axis

            // Clamp miss target to field boundaries
            missTargetX = Math.max(BALL_SIZE / 2, Math.min(FIELD_WIDTH - BALL_SIZE / 2, missTargetX));
            missTargetY = Math.max(BALL_SIZE / 2, Math.min(FIELD_HEIGHT - BALL_SIZE / 2, missTargetY));
            gameState.ballTargetPosition = { x: missTargetX, y: missTargetY };
        }

        passFeedback.textContent = gameState.lastPassFeedback;

        animateBall(gameState.ballPosition, gameState.ballTargetPosition, PASS_ANIMATION_DURATION, () => {
            if (gameState.kickOutcome === 'pass_success') {
                gameState.score++;
                updateGameUI();
                // Ball reached teammate, now animate to goal
                const goalTarget = { x: FIELD_WIDTH / 2, y: GOAL_LINE_Y + 10 }; // Just past the goal line
                showKickOutcomeText('GOAL!', 'var(--accent-yellow)');
                animateBall(gameState.ballPosition, goalTarget, PASS_ANIMATION_DURATION, () => {
                    setupNewChallenge(); // Start next round
                    updateGameUI();
                });
            } else if (gameState.kickOutcome === 'miss') {
                if (gameState.misses >= MAX_MISSES) {
                    endGame();
                } else {
                    setupNewChallenge(); // Start next round
                    updateGameUI();
                }
            }
        });
    }

    /**
     * Ends the game and transitions to the Game Over screen.
     */
    function endGame() {
        finalScoreMessage.textContent = `Final Score for ${gameState.playerName}: ${gameState.score}`;
        showScreen('game-over-screen');
    }

    /**
     * Resets the game state and starts from the name input screen.
     */
    function resetGame() {
        gameState.playerName = '';
        gameState.score = 0;
        gameState.misses = 0;
        gameState.currentDifficulty = { level: 'easy', tolerance: 10 }; // Reset to default
        playerNameInput.value = ''; // Clear input field
        showScreen('name-input-screen');
    }

    // --- Event Listeners ---

    // Name Input Screen
    nextButton.addEventListener('click', () => {
        const name = playerNameInput.value.trim();
        if (name) {
            gameState.playerName = name;
            welcomeMessage.textContent = `Hi, ${gameState.playerName}!`;
            showScreen('difficulty-screen');
        } else {
            alert("Please enter your name!"); // Using alert for simplicity, consider a nicer in-app message
        }
    });
    playerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            nextButton.click();
        }
    });

    // Difficulty Selection Screen
    startGameButton.addEventListener('click', () => {
        let selectedDifficulty = 'easy';
        let tolerance = 10;
        difficultyOptions.forEach(radio => {
            if (radio.checked) {
                selectedDifficulty = radio.value;
            }
        });

        switch (selectedDifficulty) {
            case 'easy': tolerance = 10; break;
            case 'medium': tolerance = 5; break;
            case 'hard': tolerance = 3; break;
            case 'pro': tolerance = 2; break;
        }
        gameState.currentDifficulty = { level: selectedDifficulty, tolerance: tolerance };
        showScreen('playing-screen');
        setupNewChallenge(); // Start the first challenge
    });
    startGameButton.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            startGameButton.click();
        }
    });

    // Playing Screen
    angleInput.addEventListener('input', () => {
        // Live update of trajectory guide as user types
        const val = parseInt(angleInput.value, 10);
        if (!isNaN(val) && val >= 0 && val <= 180) {
            gameState.playerInputAngle = val;
            angleError.textContent = ''; // Clear error if input becomes valid
        } else {
            angleError.textContent = "Angle must be 0-180.";
        }
        updateTrajectoryGuide();
    });

    angleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !gameState.isPassing) {
            passButton.click();
        }
    });

    passButton.addEventListener('click', handlePassRequested);

    // Game Over Screen
    playAgainButton.addEventListener('click', resetGame);
    playAgainButton.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            playAgainButton.click();
        }
    });

    // --- Responsive Scaling for Football Field ---
    // This function ensures the fixed-size field scales down to fit the available space
    function scaleFootballField() {
        const gameContainerRect = footballField.parentElement.getBoundingClientRect(); // Get bounds of the wrapper
        const fieldWidth = FIELD_WIDTH; // JS constant
        const fieldHeight = FIELD_HEIGHT; // JS constant

        const scaleX = gameContainerRect.width / fieldWidth;
        const scaleY = gameContainerRect.height / fieldHeight;

        // Use the smaller scale to ensure the entire field fits
        const scale = Math.min(scaleX, scaleY);

        if (scale < 1) { // Only scale down if necessary
            footballField.style.setProperty('--field-scale', scale);
        } else { // If there's enough space, reset scale to 1 (original size)
            footballField.style.setProperty('--field-scale', 1);
        }
        // Reposition entities after scaling the field, as their pixel positions will be transformed
        // No, this is handled by the JS itself with fixed FIELD_WIDTH/HEIGHT. The CSS transform scales the *entire* field.
        // So entity positions are still calculated relative to FIELD_WIDTH/HEIGHT.
        // What we need to ensure is that the coordinates passed to updateElementPosition are absolute within the *unscaled* FIELD.
        // The CSS handles the visual scaling. No need to re-position entities here due to field scaling.
        // However, we do need to ensure the initial setup correctly uses the fixed FIELD_WIDTH/HEIGHT.
    }

    // Call scale function on load and resize
    window.addEventListener('resize', scaleFootballField);


    // --- Initialization ---
    document.addEventListener('DOMContentLoaded', () => {
        currentYearSpan.textContent = new Date().getFullYear();
        // Set initial position for player and other entities based on JS constants
        const playerPos = {
            x: FIELD_WIDTH * PLAYER_START_X_RATIO,
            y: FIELD_HEIGHT * PLAYER_START_Y_RATIO
        };
        updateElementPosition(playerEntity, playerPos, PLAYER_SIZE);

        ballEntity.style.width = `${BALL_SIZE}px`;
        ballEntity.style.height = `${BALL_SIZE}px`;

        teammateEntity.style.width = `${TEAMMATE_SIZE}px`;
        teammateEntity.style.height = `${TEAMMATE_SIZE}px`;

        opponentEntities.forEach(opp => {
            opp.style.width = `${OPPONENT_SIZE}px`;
            opp.style.height = `${OPPONENT_SIZE}px`;
        });

        // Apply initial scaling
        scaleFootballField();

        // Ensure the initial screen is shown
        showScreen('name-input-screen');
    });
});