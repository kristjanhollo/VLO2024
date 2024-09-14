const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

let groups = []; // To store the grouped players

// Function to process and assign players to groups
const processPlayerGroups = (results) => {
    const groupMap = {};

    // Iterate over each player in the Results array
    results.forEach(player => {
        const groupNumber = player.Group;

        // If the group does not exist in the map, create a new array for it
        if (!groupMap[groupNumber]) {
            groupMap[groupNumber] = [];
        }

        // Add the player to the appropriate group
        groupMap[groupNumber].push({
            username: player.Name,
            checkedIn: false
        });
    });

    // Convert groupMap into the desired array format
    groups = Object.keys(groupMap).map(groupNumber => ({
        groupName: `Group ${groupNumber}`,
        users: groupMap[groupNumber]
    }));
};

// Function to fetch player data from the API
const fetchPlayerData = async () => {
    try {
        const response = await axios.get('https://discgolfmetrix.com/api.php?content=result&id=3084337');
        const results = response.data.Competition.Results; // Access the 'Results' array
        processPlayerGroups(results); // Process and group players
        console.log('Groups processed:', groups);
    } catch (error) {
        console.error('Error fetching player data:', error);
    }
};

// Fetch player data when the server starts
fetchPlayerData();

// Serve static files (the HTML page) from the "public" directory
app.use(express.static('public'));

// Handle socket connection
io.on('connection', (socket) => {
    console.log('A user connected');

    // Send the current group list to the client when they connect
    socket.emit('loadGroups', groups);

    // Handle individual user check-in updates
    socket.on('checkInUser', (data) => {
        groups = groups.map(group => ({
            ...group,
            users: group.users.map(user => 
                user.username === data.username ? { ...user, checkedIn: data.checkedIn } : user
            )
        }));

        // Broadcast the updated groups to all connected clients
        io.emit('loadGroups', groups);
    });

    // Handle group-level check-in updates
    socket.on('checkInGroup', (data) => {
        groups = groups.map(group => 
            group.groupName === data.groupName
                ? { 
                    ...group, 
                    users: group.users.map(user => ({ ...user, checkedIn: data.checkedIn })) 
                }
                : group
        );

        // Broadcast the updated groups to all connected clients
        io.emit('loadGroups', groups);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

// Start the server on port 3000
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
