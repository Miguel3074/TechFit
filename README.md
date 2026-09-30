# TechFit

TechFit is a mobile-first front-end prototype designed for people who spend most of their workday sitting, such as developers and office workers.

The application provides short, low-impact workout sessions that can be completed during work breaks. Its main goals are to reduce physical discomfort, improve mobility, and encourage healthier habits during the workday.

## Features

- Free and Premium access levels
- Workout restrictions based on the selected plan
- Short workouts focused on the lower back, wrists, neck, and full-body mobility
- Detailed instructions before each workout
- Countdown timer with pause and resume controls
- Workout completion celebration
- Local persistence for user data, preferences, and completed workouts
- Weekly activity report
- Body discomfort progress report
- Responsive mobile-first interface

## Academic Requirements

The prototype addresses the main project requirements:

1. **Access control:** Free and Premium user levels provide different access to workouts and reports.
2. **Data persistence:** User information, preferences, plan, and workout history are stored with the browser's `localStorage` API.
3. **Reports:** The application includes an activity report and a body discomfort progress report.

## Technologies

- HTML5
- CSS3
- JavaScript
- Browser Local Storage

## Running Locally

Clone the repository:

```bash
git clone https://github.com/Miguel3074/TechFit.git
cd TechFit
```

Start a local web server:

```bash
python -m http.server 8000 --directory dist
```

Open `http://localhost:8000` in your browser.

## Project Structure

```text
dist/
├── index.html
├── styles.css
└── app.js
```

## Project Status

This project is a front-end academic prototype. Authentication and persistence are simulated locally and do not currently use a remote server or database.

## Authors

- Miguel Brack
- Artur
