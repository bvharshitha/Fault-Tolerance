import os

role = os.getenv("ROLE")

if role == "coordinator":
    from coordinator import run_coordinator
    run_coordinator()
elif role == "participant":
    from participant import run_participant
    run_participant()
else:
    print("Please set ROLE environment variable to 'coordinator' or 'participant'",flush=True)
