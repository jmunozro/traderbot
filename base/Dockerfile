FROM node:10-alpine

WORKDIR /home/node/app

ADD *.js /home/node/app/
ADD *.json /home/node/app/

RUN npm install

USER node

EXPOSE 3000

CMD ["node", "index.js"]