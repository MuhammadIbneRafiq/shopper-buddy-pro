const token = "bedrock-api-key-YmVkcm9jay5hbWF6b25hd3MuY29tLz9BY3Rpb249Q2FsbFdpdGhCZWFyZXJUb2tlbiZYLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFTSUFYRjdFUExMQVpFSkI2Tk5UJTJGMjAyNjA0MjQlMkZ1cy1lYXN0LTElMkZiZWRyb2NrJTJGYXdzNF9yZXF1ZXN0JlgtQW16LURhdGU9MjAyNjA0MjRUMjA0NzU0WiZYLUFtei1FeHBpcmVzPTQzMjAwJlgtQW16LVNlY3VyaXR5LVRva2VuPUlRb0piM0pwWjJsdVgyVmpFTDMlMkYlMkYlMkYlMkYlMkYlMkYlMkYlMkYlMkYlMkZ3RWFDWFZ6TFdWaGMzUXRNU0pITUVVQ0lRQ0lQNEpyNEJTekg5cjclMkY4TjU3VkZQJTJCWHZ3M3hHN0dRMXBEUTdzU2tKNDNnSWdYZXQ4TjNLa0sxcnVUR01CVXZBZ2d5QWhBVWRITUFPclZDZEN3dktyMnpVcXZRTUlodiUyRiUyRiUyRiUyRiUyRiUyRiUyRiUyRiUyRiUyRkFSQURHZ3cwT1RNNE5qTTFNalV3TlRjaURJaTRmY0JadmROVkl2QjBVU3FSQTFGdVRQQ3NOanljMHdFV3NUNW10MlozdCUyRnZJaU81VUhwQVFyTVJwbnRiT2hId2ZzMWpKbTRJT0Y1WnUzQ2Fxd0FhRjBnSDlTJTJCQldJcmpGbnc1MHRhTTlMcVFGTDR6VTh1UEtaQXl6UCUyQjZBVkxFVyUyQnRKZ2tJUFNlYSUyRlgyUGdYU1glMkJNYzZ6QzVHSUZNMXh4R2hMMURYUlFlbGlORkFLT0REVkQ1clJXTXhMZ2txU2NIVVltR1puelElMkJibnJiRklTVnBuSyUyRlhtbXEzZjhWV2g2QlJsRmVyR0h2cXJnWnRGOGpmZ3FQY21WZURFQVhpNzFtWms2RmFVSm9ZeTVWb3I3Z3dWWG1VWmdESTI3WWJUbzREWkE4ZjZyanlLbDh4SWUzTHlqdkw1emlKNmIwaXVzZFZJTlNtM08xVTI4THlySUJXRTMlMkZ1RVNSVERORW8xSjlQMTdYUUdHM1Zvc1FLQlZMdEd5ZzhyYlJOYVBJV3IlMkZkRHcxSFZmZDltVXF3cmhlR2swbEZwaXVUdkclMkJFbEs1czhKVENOSWpDNXM0WTZsVkpZSVphZkNYVUljek5BTEZqeW1yc1NZOFZLTEdOU2NwaDlLSGR6QWNZZGswM2NSdmJLTGxuYVNnYjFNSmh5VnVJNndkbDZsd1VFNDcyOWNHaGVRa25Qd3g0N3RmRzRIJTJCSmFjOE5qMkw2cGVlclRlcVlBMEtvS2ZNS0tycjg4R09yY0NkcjdIVUM3c0FMUUNyVSUyRnBoYjdmVDJvSVpBd0lpQXNrQU1UYzdvOXFUM0pNQnBNRXZNRDNFWHhuUTJlczNOM0VlS0xGY1ZtQ1RTWlF5dUF5JTJCdUZ1WUJQMTRoOG5QNW1mQnZuc2EzQVczSnclMkJJNFdkS25nazdhNVA1c0RqcUZFWXh4MEhTZjZCaXQ5JTJGUUFyUzJ0Ukt2ZDNQJTJGRVBFTUlCZWN1b0J2RkxGczA3Uk83b1I4UUJqUVpYRWpBSk9WZGNuUXhuRG1BUEtEaCUyRjlOTjQxQlZsQkJHR1g3ODBYeEslMkI1dEM4JTJGMHJjN04lMkZGU3JrSUpIeWxOMWJZcmtYclg3SnR5TnMzb3hmUyUyRlkwVWtmVWs3V1o5d0ROSW1tV0RsVkJ1QUd5emZKVTF2MVRQNjkyJTJGN0NUcktZaUtndyUyQmRpWGxrb2ZKY2dNSVNIbTFlbXRRY1NZJTJGQ0JuRk9hUTVzWGolMkYlMkJteWNMZUo4eWVwOE12VyUyQm1JTXZoamN3MTQlMkZwOFElMkJaU2QlMkZjajdleTZ1TTRpWWxEWXJieEhaaXl3QlczYmhicEklM0QmWC1BbXotU2lnbmF0dXJlPTk0Y2Q4OTE5NjhjOWQ3MzFjODc3ZWE2MTI4MTZiM2IyYjhkNjRkZjRhYjkwYWY2NWZiN2IyMDIwOGI2ZGIwM2QmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0JlZlcnNpb249MQ==";

async function testBedrock() {
    const modelId = "anthropic.claude-3-haiku-20240307-v1:0";
    const url = `https://bedrock-runtime.us-east-1.amazonaws.com/model/${modelId}/converse`;

    console.log("Sending request to Claude 3 Haiku via Bedrock API...");

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                messages: [{ role: "user", content: [{ text: "Hello! If you receive this, just reply exactly with 'BEDROCK_OK'" }] }]
            })
        });

        if (!response.ok) {
            console.error("Error Status:", response.status);
            console.error(await response.text());
            return;
        }

        const data = await response.json();
        console.log("Success! Response from model:");
        console.log(data.output.message.content[0].text);
    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

testBedrock();
